"""Day moments ("Momentos del día"): several looks per day.

A moment is not a table of its own: it is the set of a user's outfits for one
day (`Outfit.scheduled_for`) that share `Outfit.moment_order`. Alternatives,
wore-instead replacements and the eventually worn look all live in the same
moment; `current_outfit` picks the one to show. Legacy days have every outfit
at order 0 with no label, i.e. one default moment.

Suggestions go through the AI stylist when the user has text AI; otherwise (or
when the provider fails) `compose_outfit` builds one from the heuristic item
scorer. A "transition" look reuses an earlier moment's look and swaps only one
or two pieces, in the AI prompt and in the heuristic alike.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem
from app.models.outfit import (
    FamilyOutfitRating,
    Outfit,
    OutfitItem,
    OutfitSource,
    OutfitStatus,
)
from app.models.user import User
from app.services.ai_service import AIDisabledError
from app.services.item_scorer import get_season, score_items
from app.services.recommendation_service import (
    MIN_CANDIDATES_FOR_OUTFIT,
    AIRecommendationError,
    InsufficientWardrobeError,
    MomentSpec,
    RecommendationService,
    apply_moment,
)
from app.services.weather_service import WeatherData
from app.utils.clothing import ITEM_ROLE, canonical_item_order
from app.utils.timezone import get_user_today

logger = logging.getLogger(__name__)

MAX_MOMENTS_PER_DAY = 6

# Most-visible first: live outfits of a moment by how settled they are.
_LIVE_STATUSES = {
    OutfitStatus.accepted: 1,
    OutfitStatus.pending: 2,
    OutfitStatus.sent: 2,
    OutfitStatus.viewed: 2,
}

DRESSY_OCCASIONS = {"date", "dinner", "party", "wedding", "formal", "interview"}

# Which piece a transition swaps first (blazer -> leather jacket, sneaker -> boot...).
TRANSITION_SWAP_PRIORITY = ("outer_layer", "footwear", "mid_layer", "base_top")


class MomentNotFoundError(LookupError):
    pass


class MomentWornError(Exception):
    """The moment already has a worn look; it can't be regenerated or removed."""


class TooManyMomentsError(Exception):
    pass


# --- Grouping --------------------------------------------------------------------


def _is_worn(outfit: Outfit) -> bool:
    return outfit.feedback is not None and outfit.feedback.worn_at is not None


def _when(outfit: Outfit) -> datetime:
    ts = outfit.responded_at or outfit.created_at
    if ts is None:
        return datetime.min.replace(tzinfo=UTC)
    return ts if ts.tzinfo else ts.replace(tzinfo=UTC)


def current_outfit(outfits: list[Outfit]) -> Outfit | None:
    """The look to show for a moment: worn > accepted > pending, newest first."""
    ranked: list[tuple[int, Outfit]] = []
    for o in outfits:
        if _is_worn(o):
            ranked.append((0, o))
        elif o.status in _LIVE_STATUSES:
            ranked.append((_LIVE_STATUSES[o.status], o))
    if not ranked:
        return None
    best_tier = min(t for t, _ in ranked)
    return max((o for t, o in ranked if t == best_tier), key=_when)


@dataclass
class DayMoment:
    order: int
    label: str | None
    at: time | None
    occasion: str
    outfit: Outfit | None
    outfits: list[Outfit] = field(default_factory=list)
    transition_from_order: int | None = None
    # Items shared with the previous moment's look (what you don't need to change).
    shared_item_ids: list[UUID] = field(default_factory=list)

    @property
    def is_worn(self) -> bool:
        return any(_is_worn(o) for o in self.outfits)


def group_moments(outfits: list[Outfit]) -> list[DayMoment]:
    by_order: dict[int, list[Outfit]] = {}
    for o in outfits:
        by_order.setdefault(o.moment_order or 0, []).append(o)

    moments: list[DayMoment] = []
    for order in sorted(by_order):
        group = by_order[order]
        cur = current_outfit(group)
        ref = cur or max(group, key=_when)
        moments.append(
            DayMoment(
                order=order,
                label=ref.moment_label,
                at=ref.moment_time,
                occasion=ref.occasion,
                outfit=cur,
                outfits=group,
            )
        )

    order_of = {o.id: m.order for m in moments for o in m.outfits}
    previous: DayMoment | None = None
    for m in moments:
        if m.outfit is not None:
            if m.outfit.transition_from_outfit_id is not None:
                m.transition_from_order = order_of.get(m.outfit.transition_from_outfit_id)
            if previous is not None and previous.outfit is not None:
                prev_ids = {oi.item_id for oi in previous.outfit.items}
                m.shared_item_ids = [
                    oi.item_id
                    for oi in sorted(m.outfit.items, key=lambda x: x.position)
                    if oi.item_id in prev_ids
                ]
            previous = m
    return moments


# --- Heuristic composer (no AI) --------------------------------------------------


def _role(item: ClothingItem) -> str | None:
    role = ITEM_ROLE.get((item.type or "").lower())
    if role == "neckwear":
        return "accessory"
    return role


@dataclass
class ComposedOutfit:
    item_ids: list[UUID]
    kept: list[UUID] = field(default_factory=list)
    added: list[UUID] = field(default_factory=list)
    removed: list[UUID] = field(default_factory=list)


def _is_cool(weather: WeatherData) -> bool:
    return weather.feels_like < 16 or weather.precipitation_chance >= 60


def compose_outfit(
    ranked: list[tuple[ClothingItem, float]],
    weather: WeatherData,
    occasion: str,
    base: list[ClothingItem] | None = None,
    pinned: ClothingItem | None = None,
) -> ComposedOutfit:
    """Build one look from items ranked best-first (item, score).

    With ``base`` (a transition) keep that look and change at most two things:
    swap one piece for a better fit for the new occasion (outer layer first,
    then shoes...) and add an accessory.

    With ``pinned`` (a rescue) that garment is the look's starting point: it wins
    its own body slot outright and, if its role would not have been filled at
    all, it is added anyway. ``pinned`` must be one of the ``ranked`` items.
    """
    by_role: dict[str, list[tuple[ClothingItem, float]]] = {}
    for item, score in ranked:
        role = _role(item)
        if role:
            by_role.setdefault(role, []).append((item, score))

    if pinned is not None:
        pinned_role = _role(pinned)
        if pinned_role:
            slot = by_role.setdefault(pinned_role, [])
            others = [(i, sc) for i, sc in slot if i.id != pinned.id]
            by_role[pinned_role] = [(pinned, float("inf"))] + others

    def best(role: str, exclude: set[UUID]) -> ClothingItem | None:
        for item, _ in by_role.get(role, []):
            if item.id not in exclude:
                return item
        return None

    if base:
        base_ids = {i.id for i in base}
        result = list(base)
        added: list[UUID] = []
        removed: list[UUID] = []
        changes = 0
        for role in TRANSITION_SWAP_PRIORITY:
            current = next((i for i in result if _role(i) == role), None)
            if current is None:
                continue
            alt = best(role, base_ids)
            if alt is not None:
                result[result.index(current)] = alt
                added.append(alt.id)
                removed.append(current.id)
                changes += 1
                break
        if (
            changes == 0
            and _is_cool(weather)
            and not any(_role(i) == "outer_layer" for i in result)
        ):
            outer = best("outer_layer", base_ids)
            if outer is not None:
                result.append(outer)
                added.append(outer.id)
                changes += 1
        accessory = best("accessory", base_ids)
        if accessory is not None and changes < 2:
            result.append(accessory)
            added.append(accessory.id)
        return ComposedOutfit(
            item_ids=[i.id for i in result],
            kept=[i.id for i in base if i.id not in set(removed)],
            added=added,
            removed=removed,
        )

    picked: list[ClothingItem] = []
    scores = {item.id: score for item, score in ranked}
    top, bottom = best("base_top", set()), best("bottom", set())
    full = best("full_body", set())
    pinned_role = _role(pinned) if pinned is not None else None
    if pinned_role == "full_body":
        # A pinned dress is the look; a top and a bottom would fight it for the slot.
        wear_full = True
    elif pinned_role in ("base_top", "bottom"):
        wear_full = False
    else:
        wear_full = full is not None and (
            top is None
            or bottom is None
            or scores[full.id] >= (scores[top.id] + scores[bottom.id]) / 2
        )
    if wear_full and full is not None:
        picked.append(full)
    else:
        picked += [i for i in (top, bottom) if i is not None]
    for role in ("footwear",):
        item = best(role, set())
        if item is not None:
            picked.append(item)
    if _is_cool(weather):
        outer = best("outer_layer", set())
        if outer is not None:
            picked.append(outer)
        if weather.feels_like < 8:
            mid = best("mid_layer", set())
            if mid is not None:
                picked.append(mid)
    if occasion in DRESSY_OCCASIONS:
        accessory = best("accessory", set())
        if accessory is not None:
            picked.append(accessory)

    if pinned is not None and all(i.id != pinned.id for i in picked):
        # Its role never came up (an accessory on a plain day, a type we have no
        # role for). A rescue is about this garment, so it goes in regardless.
        picked.append(pinned)

    if len(picked) < MIN_CANDIDATES_FOR_OUTFIT:
        raise InsufficientWardrobeError("Wardrobe has fewer than two usable items.")
    return ComposedOutfit(item_ids=[i.id for i in picked])


NEUTRAL_WEATHER = WeatherData(
    temperature=18.0,
    feels_like=18.0,
    humidity=50,
    precipitation_chance=0,
    precipitation_mm=0.0,
    wind_speed=0.0,
    condition="unknown",
    condition_code=0,
    is_day=True,
    uv_index=0.0,
    timestamp=datetime(2000, 1, 1, tzinfo=UTC),
)


# --- Service ---------------------------------------------------------------------


@dataclass
class MomentRequest:
    order: int | None = None  # None = add a new moment at the end
    label: str | None = None
    at: time | None = None
    occasion: str | None = None
    transition: bool = False


@dataclass
class SuggestResult:
    outfit: Outfit
    engine: str  # "ai" | "heuristic"


class DayMomentService:
    def __init__(self, db: AsyncSession, rng: random.Random | None = None):
        self.db = db
        self.rng = rng or random.Random()

    async def load_day(self, user_id: UUID, day: date) -> list[Outfit]:
        result = await self.db.execute(
            select(Outfit)
            .where(and_(Outfit.user_id == user_id, Outfit.scheduled_for == day))
            .options(
                selectinload(Outfit.items)
                .selectinload(OutfitItem.item)
                .selectinload(ClothingItem.additional_images),
                selectinload(Outfit.feedback),
                selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
            )
            .order_by(Outfit.moment_order, Outfit.created_at)
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().unique().all())

    async def get_day(self, user_id: UUID, day: date) -> list[DayMoment]:
        return group_moments(await self.load_day(user_id, day))

    async def suggest(self, user: User, day: date, req: MomentRequest) -> SuggestResult:
        moments = await self.get_day(user.id, day)
        existing = next((m for m in moments if m.order == req.order), None)

        if req.order is None or existing is None:
            if len(moments) >= MAX_MOMENTS_PER_DAY:
                raise TooManyMomentsError()
            order = (
                req.order
                if req.order is not None
                else (max((m.order for m in moments), default=-1) + 1)
            )
            label, at = req.label, req.at
        else:
            if existing.is_worn:
                raise MomentWornError()
            order = existing.order
            label = req.label if req.label is not None else existing.label
            at = req.at if req.at is not None else existing.at

        occasion = req.occasion or (existing.occasion if existing else None)
        if not occasion:
            prefs = user.preferences
            occasion = (prefs.default_occasion if prefs else None) or "casual"

        base_moment: DayMoment | None = None
        if req.transition:
            earlier = [m for m in moments if m.order < order and m.outfit is not None]
            base_moment = earlier[-1] if earlier else None

        spec = MomentSpec(
            order=order,
            label=label,
            at=at,
            transition_from=base_moment.outfit if base_moment else None,
            transition_from_label=base_moment.label if base_moment else None,
        )

        rec = RecommendationService(self.db)
        engine = "ai"
        try:
            outfit = await rec.generate_recommendation(
                user=user,
                occasion=occasion,
                source=OutfitSource.on_demand,
                scheduled_date=day,
                moment=spec,
            )
        except AIDisabledError as e:
            # No AI for this user (free plan, quota, kill switch): heuristic look.
            logger.info("Day moment without AI for user %s: %s", user.id, type(e).__name__)
            engine = "heuristic"
        except AIRecommendationError as e:
            # Provider down or unusable answer: still give the user a look.
            logger.warning("AI stylist failed for a day moment, using heuristic: %s", e)
            engine = "heuristic"
        if engine == "heuristic":
            outfit = await self._heuristic_outfit(user, day, occasion, spec)

        # Regenerating: the previous live looks of this moment step aside.
        if existing is not None:
            for o in existing.outfits:
                if o.id != outfit.id and o.status in _LIVE_STATUSES and not _is_worn(o):
                    o.status = OutfitStatus.skipped
                    o.responded_at = datetime.now(UTC)
            await self.db.commit()
        return SuggestResult(outfit=outfit, engine=engine)

    async def _heuristic_outfit(
        self, user: User, day: date, occasion: str, spec: MomentSpec
    ) -> Outfit:
        rec = RecommendationService(self.db)
        try:
            weather = await rec.resolve_weather(user)
        except ValueError:
            weather = NEUTRAL_WEATHER

        prefs = user.preferences
        candidates = await rec.get_candidate_items(
            user=user, weather=weather, occasion=occasion, preferences=prefs, exclude_items=[]
        )
        base_items: list[ClothingItem] = []
        if spec.transition_from is not None:
            base_items = [oi.item for oi in spec.transition_from.items if oi.item is not None]
            candidates = await rec.ensure_items_in_candidates(
                user, candidates, [i.id for i in base_items]
            )
        if len(candidates) < MIN_CANDIDATES_FOR_OUTFIT:
            raise InsufficientWardrobeError("Wardrobe has fewer than two usable items.")

        user_today = get_user_today(user)
        lat = float(user.location_lat) if user.location_lat is not None else None
        scored = score_items(
            items=candidates,
            weather=weather,
            occasion=occasion,
            preferences=prefs,
            user_today=user_today,
            current_season=get_season(user_today.month, lat),
            learned_prefs=None,
            good_pairs={},
            recently_worn_dates={},
            min_items=0,
        )
        # A little jitter so "another idea" doesn't return the same look.
        ranked = sorted(
            ((s.item, s.score * self.rng.uniform(0.8, 1.0)) for s in scored),
            key=lambda x: x[1],
            reverse=True,
        )
        composed = compose_outfit(ranked, weather, occasion, base=base_items or None)

        type_map = {i.id: (i.type or "").lower() for i in candidates}
        ordered = canonical_item_order(composed.item_ids, type_map)
        raw: dict = {"_engine": "heuristic"}
        if spec.transition_from is not None:
            raw["_transition"] = {
                "kept": [str(i) for i in composed.kept],
                "added": [str(i) for i in composed.added],
                "removed": [str(i) for i in composed.removed],
            }
        outfit = Outfit(
            user_id=user.id,
            occasion=occasion,
            weather_data=weather.to_dict() if weather is not NEUTRAL_WEATHER else None,
            scheduled_for=day,
            ai_raw_response=raw,
            source=OutfitSource.on_demand,
            status=OutfitStatus.pending,
        )
        apply_moment(outfit, spec)
        self.db.add(outfit)
        await self.db.flush()
        for position, item_id in enumerate(ordered):
            self.db.add(OutfitItem(outfit_id=outfit.id, item_id=item_id, position=position))
        await self.db.commit()

        result = await self.db.execute(
            select(Outfit)
            .where(Outfit.id == outfit.id)
            .options(
                selectinload(Outfit.items)
                .selectinload(OutfitItem.item)
                .selectinload(ClothingItem.additional_images),
                selectinload(Outfit.feedback),
                selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
            )
            .execution_options(populate_existing=True)
        )
        return result.scalar_one()

    async def delete_moment(self, user_id: UUID, day: date, order: int) -> None:
        moments = await self.get_day(user_id, day)
        moment = next((m for m in moments if m.order == order), None)
        if moment is None:
            raise MomentNotFoundError()
        if moment.is_worn:
            raise MomentWornError()
        for o in moment.outfits:
            await self.db.delete(o)
        await self.db.commit()
