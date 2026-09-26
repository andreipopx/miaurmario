"""«Rescátala»: ask the stylist for a look built around one forgotten garment.

This is the ordinary suggestion path with the garment pinned — the AI stylist
when the user has text AI (``include_items``), the heuristic composer otherwise
(``compose_outfit(pinned=...)``). Nothing here is a second ranking engine.

When no look can be built, the answer says so and says *why*, as codes the
frontend turns into sentences. The diagnosis is deliberately plain: "es tu única
prenda verde", "no tienes nada de abajo que ponerle", "todo lo demás está para
lavar". It never suggests buying anything.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import (
    FamilyOutfitRating,
    Outfit,
    OutfitItem,
    OutfitSource,
    OutfitStatus,
)
from app.models.user import User
from app.services.ai_access import AIAccessError
from app.services.ai_service import AIDisabledError
from app.services.day_moments import NEUTRAL_WEATHER, compose_outfit
from app.services.item_scorer import FORMALITY_ORDER, get_season, score_items
from app.services.recommendation_service import (
    MIN_CANDIDATES_FOR_OUTFIT,
    AIRecommendationError,
    InsufficientWardrobeError,
    RecommendationService,
)
from app.utils.clothing import ITEM_ROLE, canonical_item_order
from app.utils.style_quiz import layering_allowed
from app.utils.timezone import get_user_today

logger = logging.getLogger(__name__)

#: Which roles a look cannot do without, per the garment's own role. A shirt with
#: no bottoms in the wardrobe genuinely has nothing to go with.
_COMPANION_ROLES: dict[str, tuple[str, ...]] = {
    "base_top": ("bottom", "full_body"),
    "bottom": ("base_top", "full_body"),
    "mid_layer": ("base_top", "full_body"),
    "outer_layer": ("base_top", "full_body"),
    "footwear": ("base_top", "bottom", "full_body"),
    "accessory": ("base_top", "bottom", "full_body"),
    "neckwear": ("base_top", "bottom", "full_body"),
    "socks": ("base_top", "bottom", "full_body"),
}


def _role(item: ClothingItem) -> str | None:
    role = ITEM_ROLE.get((item.type or "").lower())
    return "accessory" if role == "neckwear" else role


def _colors_of(item: ClothingItem) -> set[str]:
    colors = {(c or "").lower() for c in (item.colors or []) if c}
    if item.primary_color:
        colors.add(item.primary_color.lower())
    return colors


@dataclass
class RescueHint:
    """One plain reason the rescue could not happen. ``code`` is localised."""

    code: str
    value: str | None = None


@dataclass
class RescueResult:
    outfit: Outfit | None = None
    #: "ai" or "heuristic" — which engine built the look.
    engine: str | None = None
    #: Set only when ``outfit`` is None: "item_unavailable" | "no_combination".
    reason: str | None = None
    hints: list[RescueHint] = field(default_factory=list)


class ItemRescueService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def rescue(self, user: User, item: ClothingItem, occasion: str) -> RescueResult:
        if item.is_archived or item.status != ItemStatus.ready:
            return RescueResult(reason="item_unavailable")

        rec = RecommendationService(self.db)
        try:
            outfit = await rec.generate_recommendation(
                user=user,
                occasion=occasion,
                include_items=[item.id],
                single_outfit=True,
            )
            return RescueResult(outfit=outfit, engine="ai")
        except InsufficientWardrobeError:
            return RescueResult(reason="no_combination", hints=await self.diagnose(user, item))
        except (AIAccessError, AIDisabledError) as e:
            # No text AI for this user (free plan, quota, kill switch).
            logger.info("Rescue without AI for user %s: %s", user.id, type(e).__name__)
        except AIRecommendationError as e:
            logger.warning("AI stylist failed on a rescue, falling back to the composer: %s", e)
        except ValueError as e:
            # Location/weather the AI path insists on. The composer copes without.
            logger.info("Rescue falling back to the composer: %s", e)

        return await self._heuristic_rescue(user, item, occasion)

    async def _heuristic_rescue(
        self, user: User, item: ClothingItem, occasion: str
    ) -> RescueResult:
        rec = RecommendationService(self.db)
        try:
            weather = await rec.resolve_weather(user)
        except ValueError:
            weather = NEUTRAL_WEATHER

        candidates = await rec.get_candidate_items(
            user=user,
            weather=weather,
            occasion=occasion,
            preferences=user.preferences,
            exclude_items=[],
        )
        # The garment being rescued may itself be past its wash interval, or be
        # the one the wardrobe-wide exclusions hid. It is the point of the call.
        candidates = await rec.ensure_items_in_candidates(user, candidates, [item.id])
        pinned = next((i for i in candidates if i.id == item.id), None)
        if pinned is None or len(candidates) < MIN_CANDIDATES_FOR_OUTFIT:
            return RescueResult(reason="no_combination", hints=await self.diagnose(user, item))

        user_today = get_user_today(user)
        lat = float(user.location_lat) if user.location_lat is not None else None
        scored = score_items(
            items=candidates,
            weather=weather,
            occasion=occasion,
            preferences=user.preferences,
            user_today=user_today,
            current_season=get_season(user_today.month, lat),
            learned_prefs=None,
            good_pairs={},
            recently_worn_dates={},
            mandatory_item_ids={item.id},
            min_items=0,
        )
        ranked = sorted(((s.item, s.score) for s in scored), key=lambda x: x[1], reverse=True)
        if all(i.id != pinned.id for i, _ in ranked):
            ranked.append((pinned, 0.0))

        try:
            composed = compose_outfit(
                ranked,
                weather,
                occasion,
                pinned=pinned,
                # With layers allowed, the garment being rescued no longer has to
                # beat a dress for its slot — it can be worn under or over one.
                allow_layering=layering_allowed(
                    user.preferences.taste_profile if user.preferences else None
                ),
            )
        except InsufficientWardrobeError:
            return RescueResult(reason="no_combination", hints=await self.diagnose(user, item))

        type_map = {i.id: (i.type or "").lower() for i in candidates}
        ordered = canonical_item_order(composed.item_ids, type_map)

        outfit = Outfit(
            user_id=user.id,
            occasion=occasion,
            weather_data=weather.to_dict() if weather is not NEUTRAL_WEATHER else None,
            scheduled_for=user_today,
            ai_raw_response={"_engine": "heuristic", "_rescued_item": str(item.id)},
            source=OutfitSource.on_demand,
            status=OutfitStatus.pending,
        )
        self.db.add(outfit)
        await self.db.flush()
        for position, item_id in enumerate(ordered):
            self.db.add(OutfitItem(outfit_id=outfit.id, item_id=item_id, position=position))
        await self.db.commit()

        return RescueResult(outfit=await self._reload(outfit), engine="heuristic")

    async def _reload(self, outfit: Outfit) -> Outfit:
        result = await self.db.execute(
            select(Outfit)
            .where(Outfit.id == outfit.id)
            .options(
                selectinload(Outfit.items).selectinload(OutfitItem.item),
                selectinload(Outfit.feedback),
                selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
            )
            .execution_options(populate_existing=True)
        )
        return result.scalar_one()

    async def diagnose(self, user: User, item: ClothingItem) -> list[RescueHint]:
        """Why this garment has nothing to go with — as plainly as we can put it."""
        result = await self.db.execute(
            select(ClothingItem).where(
                and_(
                    ClothingItem.user_id == user.id,
                    ClothingItem.id != item.id,
                    ClothingItem.status == ItemStatus.ready,
                    ClothingItem.is_archived.is_(False),
                )
            )
        )
        others = list(result.scalars().all())
        hints: list[RescueHint] = []

        typed = [o for o in others if o.type and o.type != "unknown"]
        if len(typed) < MIN_CANDIDATES_FOR_OUTFIT - 1:
            hints.append(RescueHint(code="too_few_items", value=str(len(typed))))
            return hints

        wearable = [o for o in typed if not o.needs_wash]
        if not wearable:
            hints.append(RescueHint(code="all_need_wash"))
            return hints

        role = _role(item)
        needed = _COMPANION_ROLES.get(role or "", ())
        if needed:
            present = {_role(o) for o in wearable}
            if not (present & set(needed)):
                hints.append(RescueHint(code="missing_role", value=needed[0]))

        colors = _colors_of(item)
        if colors and not any(_colors_of(o) & colors for o in wearable):
            hints.append(
                RescueHint(code="only_color", value=(item.primary_color or sorted(colors)[0]))
            )

        formality = (item.formality or "").lower()
        if formality in FORMALITY_ORDER:
            index = FORMALITY_ORDER.index(formality)
            near = [
                o
                for o in wearable
                if (o.formality or "").lower() in FORMALITY_ORDER
                and abs(FORMALITY_ORDER.index((o.formality or "").lower()) - index) <= 1
            ]
            if not near:
                hints.append(RescueHint(code="formality_gap", value=formality))

        if not hints:
            hints.append(RescueHint(code="unknown"))
        return hints
