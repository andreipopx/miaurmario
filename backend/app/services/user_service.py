from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.schemas.user import UserCreate, UserSyncRequest, UserUpdate


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: UUID) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_external_id(
        self, external_id: str, load_preferences: bool = True
    ) -> User | None:
        query = select(User).where(User.external_id == external_id)

        if load_preferences:
            query = query.options(selectinload(User.preferences))

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def create(self, user_data: UserCreate) -> User:
        user = User(
            external_id=user_data.external_id,
            email=user_data.email,
            display_name=user_data.display_name,
            avatar_url=user_data.avatar_url,
            timezone=user_data.timezone,
            location_lat=user_data.location_lat,
            location_lon=user_data.location_lon,
            location_name=user_data.location_name,
        )
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def update(self, user: User, user_data: UserUpdate) -> User:
        update_data = user_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def sync_from_oidc(self, sync_data: UserSyncRequest) -> tuple[User, bool]:
        """
        Sync user from OIDC provider.
        Creates user if not exists, updates if exists.
        Returns (user, is_new_user).

        Migration behavior: If external_id doesn't match but email does,
        we update the external_id. This allows seamless migration between
        auth providers (e.g., TinyAuth forward-auth to direct Pocket ID OIDC).
        """
        # First, check by external_id (primary lookup for OIDC)
        user = await self.get_by_external_id(sync_data.external_id)

        if user is None:
            # Check if email already exists - this could be a migration case
            existing_by_email = await self.get_by_email(sync_data.email)
            if existing_by_email is not None:
                # Migrate existing user to new external_id (auth provider change)
                # Email is the stable identifier, external_id can change
                existing_by_email.external_id = sync_data.external_id
                existing_by_email.display_name = sync_data.display_name
                if sync_data.avatar_url:
                    existing_by_email.avatar_url = sync_data.avatar_url
                existing_by_email.last_login_at = datetime.now(UTC)
                await self.db.flush()
                await self.db.refresh(existing_by_email)
                return existing_by_email, False

            # Create new user
            user = User(
                external_id=sync_data.external_id,
                email=sync_data.email,
                display_name=sync_data.display_name,
                avatar_url=sync_data.avatar_url,
                last_login_at=datetime.now(UTC),
            )
            self.db.add(user)
            await self.db.flush()
            await self.db.refresh(user)
            return user, True
        else:
            # Update existing user - but check email conflict first
            if user.email != sync_data.email:
                existing_by_email = await self.get_by_email(sync_data.email)
                if existing_by_email is not None and existing_by_email.id != user.id:
                    raise UserEmailConflictError(
                        f"Cannot update email to {sync_data.email}: already in use by another account."
                    )

            user.email = sync_data.email
            user.display_name = sync_data.display_name
            if sync_data.avatar_url:
                user.avatar_url = sync_data.avatar_url
            user.last_login_at = datetime.now(UTC)
            await self.db.flush()
            await self.db.refresh(user)
            return user, False

    async def update_last_login(self, user: User) -> None:
        user.last_login_at = datetime.now(UTC)
        await self.db.flush()

    async def complete_onboarding(self, user: User) -> None:
        user.onboarding_completed = True
        await self.db.flush()

    async def get_or_create_by_email(self, email: str) -> User:
        """Idempotent lookup by email for passwordless flows (magic link).

        Uses `magic:<email>` as external_id when creating a fresh account.
        Applies ADMIN_EMAILS promotion on every call (see record_login).
        """
        from app.config import get_settings

        settings = get_settings()
        admin_set = settings.admin_email_set()
        email_l = email.strip().lower()

        user = await self.get_by_email(email_l)
        if user is None:
            user = User(
                external_id=f"magic:{email_l}",
                email=email_l,
                display_name=email_l.split("@")[0],
                role="admin" if email_l in admin_set else "member",
                last_login_at=datetime.now(UTC),
            )
            self.db.add(user)
            await self.db.flush()
            await self.db.refresh(user)
            return user

        await self.record_login(user)
        return user

    async def record_login(self, user: User) -> None:
        """Bookkeeping shared by every first-party login (magic link, password).

        Site admin is decided by ADMIN_EMAILS alone (``is_site_admin``, same
        rule as the AI-access/admin panel). ``users.role`` doubles as the
        *family* role (creating a family sets "admin"), so a login only
        promotes ADMIN_EMAILS users to role="admin" for legacy role checks and
        never demotes: demoting would strip family admins of their family.
        """
        from app.services.ai_access import is_site_admin

        if is_site_admin(user) and user.role != "admin":
            user.role = "admin"
        user.last_login_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(user)

    async def get_by_login_identifier(self, identifier: str) -> User | None:
        """Look up a user by email or username, case-insensitively.

        Every write path stores emails and usernames lower-cased, so a plain
        (indexed) equality on the normalized input is case-insensitive. Anything
        containing "@" is treated as an email (usernames cannot contain "@").
        """
        ident = identifier.strip().lower()
        if not ident:
            return None
        column = User.email if "@" in ident else User.username
        result = await self.db.execute(select(User).where(column == ident))
        return result.scalar_one_or_none()

    async def username_taken(self, username: str, exclude_user_id: UUID | None = None) -> bool:
        query = select(User.id).where(User.username == username.lower())
        if exclude_user_id is not None:
            query = query.where(User.id != exclude_user_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none() is not None


class UserEmailConflictError(Exception):
    pass
