"""Friendship lifecycle: request, accept, decline, cancel, remove, block, unblock."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.friendship import Friendship, FriendshipStatus
from app.models.user import User
from app.services.access_control import get_friendship_between

# What the current user sees about their relationship with someone else.
Relation = Literal["none", "friends", "outgoing", "incoming", "blocked"]


class FriendshipError(Exception):
    code: str = "friendship_error"
    status_code: int = 400


class UserNotFoundError(FriendshipError):
    # Also used when the target blocked us: indistinguishable from "no such user".
    code = "user_not_found"
    status_code = 404


class SelfFriendshipError(FriendshipError):
    code = "self_friendship"
    status_code = 400


class AlreadyFriendsError(FriendshipError):
    code = "already_friends"
    status_code = 409


class AlreadyRequestedError(FriendshipError):
    code = "already_requested"
    status_code = 409


class YouBlockedError(FriendshipError):
    code = "you_blocked_user"
    status_code = 409


class UsernameRequiredError(FriendshipError):
    # The requester needs a public username so the other side can see who asked.
    code = "username_required"
    status_code = 400


class FriendshipNotFoundError(FriendshipError):
    code = "friendship_not_found"
    status_code = 404


def relation_for(friendship: Friendship | None, viewer_id: UUID) -> Relation:
    """Relation as seen by `viewer_id`. A block by the *other* user reads as "none"."""
    if friendship is None:
        return "none"
    if friendship.status == FriendshipStatus.accepted:
        return "friends"
    if friendship.status == FriendshipStatus.pending:
        return "outgoing" if friendship.requester_id == viewer_id else "incoming"
    if friendship.status == FriendshipStatus.blocked and friendship.requester_id == viewer_id:
        return "blocked"
    return "none"


class FriendshipService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_active_by_username(self, username: str) -> User | None:
        stmt = select(User).where(
            User.username == username.strip().lower(),
            User.is_active.is_(True),
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def request(self, me: User, username: str) -> Friendship:
        """Send a friend request (auto-accepts if they already asked me)."""
        if not me.username:
            raise UsernameRequiredError()
        target = await self.get_active_by_username(username)
        if target is None:
            raise UserNotFoundError()
        if target.id == me.id:
            raise SelfFriendshipError()

        existing = await get_friendship_between(self.db, me.id, target.id)
        if existing is not None:
            if existing.status == FriendshipStatus.blocked:
                if existing.requester_id == me.id:
                    raise YouBlockedError()
                # Blocked by them: don't reveal it.
                raise UserNotFoundError()
            if existing.status == FriendshipStatus.accepted:
                raise AlreadyFriendsError()
            if existing.requester_id == me.id:
                raise AlreadyRequestedError()
            # They already asked me: accept.
            existing.status = FriendshipStatus.accepted
            existing.accepted_at = datetime.now(UTC)
            await self.db.flush()
            return existing

        friendship = Friendship(
            requester_id=me.id, addressee_id=target.id, status=FriendshipStatus.pending
        )
        self.db.add(friendship)
        try:
            await self.db.flush()
        except IntegrityError as exc:  # concurrent request between the same pair
            await self.db.rollback()
            raise AlreadyRequestedError() from exc
        return friendship

    async def _get_mine(self, me: User, friendship_id: UUID) -> Friendship:
        friendship = await self.db.get(Friendship, friendship_id)
        if friendship is None or me.id not in (friendship.requester_id, friendship.addressee_id):
            raise FriendshipNotFoundError()
        return friendship

    async def accept(self, me: User, friendship_id: UUID) -> Friendship:
        friendship = await self._get_mine(me, friendship_id)
        if friendship.status != FriendshipStatus.pending or friendship.addressee_id != me.id:
            raise FriendshipNotFoundError()
        friendship.status = FriendshipStatus.accepted
        friendship.accepted_at = datetime.now(UTC)
        await self.db.flush()
        return friendship

    async def remove(self, me: User, friendship_id: UUID) -> None:
        """Decline (incoming), cancel (outgoing), unfriend, or unblock (if I blocked).

        A user who was blocked cannot delete the block row.
        """
        friendship = await self._get_mine(me, friendship_id)
        if friendship.status == FriendshipStatus.blocked and friendship.requester_id != me.id:
            raise FriendshipNotFoundError()
        await self.db.delete(friendship)
        await self.db.flush()

    async def block(self, me: User, username: str) -> Friendship:
        target = await self.get_active_by_username(username)
        if target is None:
            raise UserNotFoundError()
        if target.id == me.id:
            raise SelfFriendshipError()
        existing = await get_friendship_between(self.db, me.id, target.id)
        if existing is not None:
            if existing.status == FriendshipStatus.blocked and existing.requester_id != me.id:
                # They already blocked me; keep their block, act as if done.
                return existing
            existing.status = FriendshipStatus.blocked
            existing.requester_id = me.id
            existing.addressee_id = target.id
            existing.accepted_at = None
            await self.db.flush()
            return existing
        friendship = Friendship(
            requester_id=me.id, addressee_id=target.id, status=FriendshipStatus.blocked
        )
        self.db.add(friendship)
        await self.db.flush()
        return friendship

    async def list_for(self, me: User) -> list[Friendship]:
        """Everything that concerns me, except blocks placed on me by others."""
        stmt = (
            select(Friendship)
            .where(
                or_(Friendship.requester_id == me.id, Friendship.addressee_id == me.id),
                or_(
                    Friendship.status != FriendshipStatus.blocked,
                    Friendship.requester_id == me.id,
                ),
            )
            .options(selectinload(Friendship.requester), selectinload(Friendship.addressee))
            .order_by(Friendship.created_at.desc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def pending_incoming_count(self, me: User) -> int:
        stmt = select(func.count(Friendship.id)).where(
            Friendship.addressee_id == me.id, Friendship.status == FriendshipStatus.pending
        )
        return int((await self.db.execute(stmt)).scalar_one())
