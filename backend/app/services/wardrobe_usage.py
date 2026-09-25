"""What the wardrobe actually gets worn: per garment, and as a whole.

Two readings of the same wear data:

* :func:`item_usage` — one garment: veces puesta, última vez, coste por uso and
  the pieces it usually goes out with.
* :func:`wardrobe_usage` — the whole wardrobe: how much of it is standing still,
  what has never been worn, what has not come out in three or six months.

**Co-wear** is counted over looks the user actually wore, not looks the stylist
merely proposed: an ``Outfit`` of theirs whose ``UserFeedback.worn_at`` is set.
Two garments are "worn together" once for every such look holding both. Accepted
-but-never-confirmed suggestions do not count, so the number never claims more
than the user told us. ``co_worn_looks`` reports the size of that base so the UI
can stay quiet when it is one or two.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitItem, UserFeedback

#: "Parado" starts at three months without a wear, and the deeper mark is six.
IDLE_DAYS = 90
LONG_IDLE_DAYS = 180
RECENT_DAYS = 30

#: Below this the numbers page says so instead of pretending to mean something.
MIN_TRACKING_DAYS = 14

TOP_CO_WORN = 4


@dataclass
class CoWornItem:
    id: object
    name: str | None
    type: str
    thumbnail_path: str | None
    times: int


@dataclass
class ItemUsage:
    wear_count: int
    last_worn_at: date | None
    days_since_last_worn: int | None
    purchase_price: Decimal | None
    #: price ÷ wears. None when there is no price, or when nothing has been worn
    #: yet — "aún sin estrenar" is the honest answer there, not infinity.
    cost_per_wear: Decimal | None
    usage_preference: str
    co_worn: list[CoWornItem] = field(default_factory=list)
    #: How many worn looks the co-wear counts come from.
    co_worn_looks: int = 0


@dataclass
class WardrobeUsage:
    #: Ready, non-archived garments — the ones the stylist can actually use.
    tracked_items: int
    never_worn: int
    idle_3m: int
    idle_6m: int
    worn_recently: int
    #: Share of the wardrobe with no wear in the last three months, never-worn
    #: garments included. 0.0 when there is nothing to measure.
    idle_percentage: float
    total_wears: int
    #: Days since the oldest garment was added — how long we have had to watch.
    tracking_days: int
    #: False while the answer would be noise rather than a finding.
    enough_data: bool


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def cost_per_wear(price: Decimal | None, wear_count: int) -> Decimal | None:
    """Price divided by wears; None when either half of that is missing."""
    if price is None or price <= 0 or wear_count <= 0:
        return None
    return _round_money(Decimal(price) / Decimal(wear_count))


async def worn_together(
    db: AsyncSession, item: ClothingItem, limit: int = TOP_CO_WORN
) -> tuple[list[CoWornItem], int]:
    """The garments this one has gone out with, most often first.

    One count per worn look (``UserFeedback.worn_at`` set) that holds both. The
    second element is how many worn looks hold this garment at all, so a caller
    can tell "never worn with anything" from "we barely have any data".
    """
    mine = aliased(OutfitItem)
    theirs = aliased(OutfitItem)

    worn_looks = (
        select(func.count(func.distinct(Outfit.id)))
        .join(mine, mine.outfit_id == Outfit.id)
        .join(UserFeedback, UserFeedback.outfit_id == Outfit.id)
        .where(
            and_(
                Outfit.user_id == item.user_id,
                mine.item_id == item.id,
                UserFeedback.worn_at.is_not(None),
            )
        )
    )
    looks = (await db.execute(worn_looks)).scalar() or 0
    if not looks:
        return [], 0

    pairs = (
        select(
            ClothingItem.id,
            ClothingItem.name,
            ClothingItem.type,
            ClothingItem.thumbnail_path,
            func.count(func.distinct(Outfit.id)).label("times"),
        )
        .select_from(Outfit)
        .join(mine, mine.outfit_id == Outfit.id)
        .join(UserFeedback, UserFeedback.outfit_id == Outfit.id)
        .join(
            theirs,
            and_(theirs.outfit_id == Outfit.id, theirs.item_id != mine.item_id),
        )
        .join(ClothingItem, ClothingItem.id == theirs.item_id)
        .where(
            and_(
                Outfit.user_id == item.user_id,
                mine.item_id == item.id,
                UserFeedback.worn_at.is_not(None),
            )
        )
        .group_by(
            ClothingItem.id,
            ClothingItem.name,
            ClothingItem.type,
            ClothingItem.thumbnail_path,
        )
        .order_by(func.count(func.distinct(Outfit.id)).desc(), ClothingItem.type)
        .limit(limit)
    )
    rows = (await db.execute(pairs)).all()
    return [
        CoWornItem(
            id=row.id,
            name=row.name,
            type=row.type,
            thumbnail_path=row.thumbnail_path,
            times=row.times,
        )
        for row in rows
    ], looks


async def item_usage(db: AsyncSession, item: ClothingItem, user_today: date) -> ItemUsage:
    co_worn, looks = await worn_together(db, item)
    days_since = (user_today - item.last_worn_at).days if item.last_worn_at else None
    return ItemUsage(
        wear_count=item.wear_count or 0,
        last_worn_at=item.last_worn_at,
        days_since_last_worn=days_since,
        purchase_price=item.purchase_price,
        cost_per_wear=cost_per_wear(item.purchase_price, item.wear_count or 0),
        usage_preference=item.usage_preference or "normal",
        co_worn=co_worn,
        co_worn_looks=looks,
    )


async def wardrobe_usage(db: AsyncSession, user_id, user_today: date) -> WardrobeUsage:
    idle_before = user_today - timedelta(days=IDLE_DAYS)
    long_idle_before = user_today - timedelta(days=LONG_IDLE_DAYS)
    recent_since = user_today - timedelta(days=RECENT_DAYS)

    ready = and_(
        ClothingItem.user_id == user_id,
        ClothingItem.status == ItemStatus.ready,
        ClothingItem.is_archived.is_(False),
    )

    row = (
        await db.execute(
            select(
                func.count(ClothingItem.id).label("total"),
                func.coalesce(func.sum(ClothingItem.wear_count), 0).label("wears"),
                func.min(ClothingItem.created_at).label("oldest"),
            ).where(ready)
        )
    ).one()
    tracked = row.total or 0

    async def count(*extra) -> int:
        return (
            await db.execute(select(func.count(ClothingItem.id)).where(and_(ready, *extra)))
        ).scalar() or 0

    never_worn = await count(ClothingItem.wear_count == 0)
    # "Parado" counts the never-worn too: a garment that has never come out is the
    # plainest case of standing still.
    idle_3m = await count(
        (ClothingItem.last_worn_at.is_(None)) | (ClothingItem.last_worn_at < idle_before)
    )
    idle_6m = await count(
        (ClothingItem.last_worn_at.is_(None)) | (ClothingItem.last_worn_at < long_idle_before)
    )
    worn_recently = await count(ClothingItem.last_worn_at >= recent_since)

    tracking_days = 0
    if row.oldest is not None:
        tracking_days = max(0, (user_today - row.oldest.date()).days)

    total_wears = int(row.wears or 0)

    return WardrobeUsage(
        tracked_items=tracked,
        never_worn=never_worn,
        idle_3m=idle_3m,
        idle_6m=idle_6m,
        worn_recently=worn_recently,
        idle_percentage=round(idle_3m / tracked * 100, 1) if tracked else 0.0,
        total_wears=total_wears,
        tracking_days=tracking_days,
        # Something worn, over a stretch long enough that "nothing worn lately"
        # means something rather than "you only just got here".
        enough_data=bool(tracked > 0 and total_wears > 0 and tracking_days >= MIN_TRACKING_DAYS),
    )
