"""Cross-user access control for the social layer.

Every endpoint that returns (or accepts a write on) another user's outfit goes
through `can_view_outfit`. Denials are reported as 404 by the callers so a
non-friend cannot even learn that an outfit id exists.

Item images are served only through HMAC-signed URLs (see
`app.utils.signed_urls`); the image endpoint itself never grants friends
session-based access. So a friend can load an item image only if an endpoint
that passed `can_view_outfit` signed that image's URL for them.
"""

from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friendship import Friendship, FriendshipStatus
from app.models.outfit import Outfit, OutfitVisibility
from app.models.user import User


def _pair_clause(a_id: UUID, b_id: UUID):
    return or_(
        and_(Friendship.requester_id == a_id, Friendship.addressee_id == b_id),
        and_(Friendship.requester_id == b_id, Friendship.addressee_id == a_id),
    )


async def get_friendship_between(db: AsyncSession, a_id: UUID, b_id: UUID) -> Friendship | None:
    stmt = select(Friendship).where(_pair_clause(a_id, b_id))
    return (await db.execute(stmt)).scalar_one_or_none()


async def are_friends(db: AsyncSession, a_id: UUID, b_id: UUID) -> bool:
    if a_id == b_id:
        return True
    stmt = select(Friendship.id).where(
        Friendship.status == FriendshipStatus.accepted, _pair_clause(a_id, b_id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def is_blocked_between(db: AsyncSession, a_id: UUID, b_id: UUID) -> bool:
    """True if either user blocked the other."""
    stmt = select(Friendship.id).where(
        Friendship.status == FriendshipStatus.blocked, _pair_clause(a_id, b_id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def accepted_friend_ids(db: AsyncSession, user_id: UUID) -> list[UUID]:
    stmt = select(Friendship.requester_id, Friendship.addressee_id).where(
        Friendship.status == FriendshipStatus.accepted,
        or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
    )
    rows = (await db.execute(stmt)).all()
    return [addr if req == user_id else req for req, addr in rows]


async def can_view_outfit_socially(db: AsyncSession, viewer: User, outfit: Outfit) -> bool:
    """Social visibility only (friends/public), ignoring family.

    - owner: always
    - private: nobody else
    - friends: accepted friends
    - public: any signed-in user that is not blocked either way
    """
    if outfit.user_id == viewer.id:
        return True
    if outfit.visibility == OutfitVisibility.private:
        return False
    owner_active = (
        await db.execute(select(User.is_active).where(User.id == outfit.user_id))
    ).scalar_one_or_none()
    if not owner_active:
        return False
    if outfit.visibility == OutfitVisibility.friends:
        return await are_friends(db, viewer.id, outfit.user_id)
    if outfit.visibility == OutfitVisibility.public:
        return not await is_blocked_between(db, viewer.id, outfit.user_id)
    return False


async def can_view_outfit(db: AsyncSession, viewer: User, outfit: Outfit) -> bool:
    """Owner, same-family member (existing family feature) or social visibility."""
    if await can_view_outfit_socially(db, viewer, outfit):
        return True
    if viewer.family_id is not None:
        owner_family = (
            await db.execute(select(User.family_id).where(User.id == outfit.user_id))
        ).scalar_one_or_none()
        if owner_family is not None and owner_family == viewer.family_id:
            return True
    return False
