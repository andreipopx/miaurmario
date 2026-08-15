"""Cross-user access control helpers (Sprint 3)."""

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friendship import Friendship, FriendshipStatus
from app.models.outfit import Outfit, OutfitVisibility
from app.models.user import User


async def are_friends(db: AsyncSession, user_a_id, user_b_id) -> bool:
    if user_a_id == user_b_id:
        return True
    stmt = select(Friendship.id).where(
        Friendship.status == FriendshipStatus.accepted,
        or_(
            and_(Friendship.requester_id == user_a_id, Friendship.addressee_id == user_b_id),
            and_(Friendship.requester_id == user_b_id, Friendship.addressee_id == user_a_id),
        ),
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def can_view_outfit(db: AsyncSession, current_user: User, outfit: Outfit) -> bool:
    """Return True if `current_user` may see `outfit`.

    Ordered by cheapest check first so hot-path queries short-circuit.
    """
    if outfit.user_id == current_user.id:
        return True
    if outfit.visibility == OutfitVisibility.public:
        return True
    if outfit.visibility == OutfitVisibility.friends:
        if await are_friends(db, current_user.id, outfit.user_id):
            return True
    if current_user.family_id is not None:
        owner_family = (
            await db.execute(select(User.family_id).where(User.id == outfit.user_id))
        ).scalar_one_or_none()
        if owner_family is not None and owner_family == current_user.family_id:
            return True
    return False
