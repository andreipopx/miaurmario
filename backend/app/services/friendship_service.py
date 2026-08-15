"""Friendship service (Sprint 3)."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friendship import Friendship, FriendshipStatus
from app.models.user import User


class FriendshipError(Exception):
    """Base class for user-facing friendship service errors."""

    code: str = "friendship_error"


class FriendNotFoundError(FriendshipError):
    code = "friend_not_found"


class SelfFriendshipError(FriendshipError):
    code = "self_friendship"


class DuplicateFriendshipError(FriendshipError):
    code = "duplicate_friendship"


class NotAddresseeError(FriendshipError):
    code = "not_addressee"


class NotPendingError(FriendshipError):
    code = "not_pending"


class FriendshipService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _existing_between(self, a_id: UUID, b_id: UUID) -> Friendship | None:
        stmt = select(Friendship).where(
            or_(
                and_(Friendship.requester_id == a_id, Friendship.addressee_id == b_id),
                and_(Friendship.requester_id == b_id, Friendship.addressee_id == a_id),
            )
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def resolve_username(self, username: str) -> User | None:
        stmt = select(User).where(User.username == username.lower(), User.is_active.is_(True))
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def request(self, current_user: User, target_username: str) -> Friendship:
        target = await self.resolve_username(target_username)
        if not target:
            raise FriendNotFoundError()
        if target.id == current_user.id:
            raise SelfFriendshipError()
        existing = await self._existing_between(current_user.id, target.id)
        if existing:
            raise DuplicateFriendshipError()
        friendship = Friendship(
            requester_id=current_user.id,
            addressee_id=target.id,
            status=FriendshipStatus.pending,
        )
        self.db.add(friendship)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            raise DuplicateFriendshipError() from exc
        await self.db.refresh(friendship)
        return friendship

    async def accept(self, current_user: User, friendship_id: UUID) -> Friendship:
        friendship = await self.db.get(Friendship, friendship_id)
        if not friendship or friendship.addressee_id != current_user.id:
            raise NotAddresseeError()
        if friendship.status != FriendshipStatus.pending:
            raise NotPendingError()
        friendship.status = FriendshipStatus.accepted
        friendship.accepted_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(friendship)
        return friendship

    async def decline(self, current_user: User, friendship_id: UUID) -> None:
        friendship = await self.db.get(Friendship, friendship_id)
        if not friendship or friendship.addressee_id != current_user.id:
            raise NotAddresseeError()
        if friendship.status != FriendshipStatus.pending:
            raise NotPendingError()
        await self.db.delete(friendship)
        await self.db.flush()

    async def block(self, current_user: User, target_username: str) -> Friendship:
        target = await self.resolve_username(target_username)
        if not target:
            raise FriendNotFoundError()
        if target.id == current_user.id:
            raise SelfFriendshipError()
        existing = await self._existing_between(current_user.id, target.id)
        if existing:
            existing.status = FriendshipStatus.blocked
            existing.requester_id = current_user.id
            existing.addressee_id = target.id
            existing.accepted_at = None
            await self.db.flush()
            await self.db.refresh(existing)
            return existing
        friendship = Friendship(
            requester_id=current_user.id,
            addressee_id=target.id,
            status=FriendshipStatus.blocked,
        )
        self.db.add(friendship)
        await self.db.flush()
        await self.db.refresh(friendship)
        return friendship

    async def list_friends(
        self, current_user: User, status_filter: FriendshipStatus | None
    ) -> list[Friendship]:
        stmt = select(Friendship).where(
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            )
        )
        if status_filter is not None:
            stmt = stmt.where(Friendship.status == status_filter)
        return list((await self.db.execute(stmt)).scalars().all())

    async def accepted_friend_ids(self, current_user: User) -> list[UUID]:
        rows = await self.list_friends(current_user, FriendshipStatus.accepted)
        friend_ids: list[UUID] = []
        for f in rows:
            other = f.addressee_id if f.requester_id == current_user.id else f.requester_id
            friend_ids.append(other)
        return friend_ids
