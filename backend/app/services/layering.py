"""What this user is allowed to layer, and what they already layer for real.

Two garments in one body slot are normally a slip the stylist made, and
`app.utils.clothing.deduplicate_by_body_slot` prunes them. Two things stop it
from pruning a *deliberate* layered look:

* **The wear log.** If this person has already worn a dress over trousers, that
  combination is not a mistake for them — whatever the rules think. The pairs
  come from the looks they actually wore (`UserFeedback.worn_at`), which is the
  same definition of "worn" the history screens use. No new table.
* **The setting.** «Me gusta superponer prendas» in «Tu estilo» (stored in
  `taste_profile`, off by default) is an explicit permission covering the
  combinations they have not worn yet.

Both are additive: with the toggle off and an empty wear log this module hands
back an empty set, and the rules behave exactly as they did before it existed.
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem
from app.models.outfit import Outfit, OutfitItem, UserFeedback
from app.models.preference import UserPreference
from app.utils.clothing import LAYERABLE_KEYS, LayerKey, layer_keys_in_look
from app.utils.style_quiz import layering_allowed

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LayeringContext:
    """Everything the body-slot rules need to know about one user."""

    #: They ticked «Me gusta superponer prendas».
    allowed: bool = False
    #: Same-slot collisions found in looks they actually wore.
    worn_keys: frozenset[LayerKey] = frozenset()

    @property
    def keep_pairs(self) -> frozenset[LayerKey]:
        """The layer keys `deduplicate_by_body_slot` must not prune."""
        return (LAYERABLE_KEYS if self.allowed else frozenset()) | self.worn_keys


async def worn_layer_keys(db: AsyncSession, user_id: UUID) -> frozenset[LayerKey]:
    """Same-slot collisions this user has worn, read off the wear log.

    One query: the garment types of every look of theirs that has a wear date,
    grouped in Python because the grouping is a handful of rows per outfit and
    the role map lives in the app, not in the database.
    """
    rows = await db.execute(
        select(OutfitItem.outfit_id, ClothingItem.type)
        .join(ClothingItem, ClothingItem.id == OutfitItem.item_id)
        .join(Outfit, Outfit.id == OutfitItem.outfit_id)
        .where(
            Outfit.user_id == user_id,
            Outfit.feedback.has(UserFeedback.worn_at.is_not(None)),
        )
    )
    by_outfit: dict[UUID, list[str]] = {}
    for outfit_id, item_type in rows:
        by_outfit.setdefault(outfit_id, []).append(item_type or "")

    keys: set[LayerKey] = set()
    for types in by_outfit.values():
        keys |= layer_keys_in_look(types)
    return frozenset(keys)


async def layering_context(db: AsyncSession, user_id: UUID) -> LayeringContext:
    """The setting plus the wear log, in one call, for one user."""
    taste_profile = (
        await db.execute(
            select(UserPreference.taste_profile).where(UserPreference.user_id == user_id)
        )
    ).scalar_one_or_none()
    return LayeringContext(
        allowed=layering_allowed(taste_profile),
        worn_keys=await worn_layer_keys(db, user_id),
    )
