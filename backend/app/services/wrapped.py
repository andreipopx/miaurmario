"""«Tu mes con Stinky»: a month of wardrobe, the Wrapped way.

Read-only and derived from what is stored: the looks worn in the month
(``user_feedback.worn_at`` and ``item_history``), the garments in them, when
garments were added, and their prices for the cost per wear. Nothing here is
cached or kept; asking again recomputes it.
"""

from __future__ import annotations

import calendar
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemHistory
from app.models.outfit import Outfit, OutfitItem, UserFeedback
from app.services.wardrobe_usage import cost_per_wear

#: A garment not worn in this long (and older than a month) counts as forgotten.
FORGOTTEN_AFTER_DAYS = 60


@dataclass
class GarmentStat:
    item: ClothingItem
    count: int = 0
    cost_per_wear: Decimal | None = None


@dataclass
class Wrapped:
    month: date
    until: date
    days_logged: int
    looks_worn: int
    garments_worn: int
    wardrobe_size: int
    top: list[GarmentStat] = field(default_factory=list)
    top_color: str | None = None
    added: int = 0
    added_by_way: dict[str, int] = field(default_factory=dict)
    forgotten_count: int = 0
    forgotten: list[GarmentStat] = field(default_factory=list)
    wardrobe_value: Decimal | None = None
    average_cost_per_wear: Decimal | None = None
    best_value: GarmentStat | None = None


def month_bounds(month: date, today: date) -> tuple[date, date]:
    start = month.replace(day=1)
    last = start.replace(day=calendar.monthrange(start.year, start.month)[1])
    return start, min(last, today)


async def build_wrapped(db: AsyncSession, user_id: UUID, month: date, today: date) -> Wrapped:
    start, until = month_bounds(month, today)

    worn = (
        await db.execute(
            select(Outfit.id, UserFeedback.worn_at)
            .join(UserFeedback, UserFeedback.outfit_id == Outfit.id)
            .where(
                Outfit.user_id == user_id,
                UserFeedback.worn_at >= start,
                UserFeedback.worn_at <= until,
            )
        )
    ).all()
    outfit_ids = {row[0] for row in worn}
    days = {row[1] for row in worn}

    wears: Counter[UUID] = Counter()
    if outfit_ids:
        for (item_id,) in await db.execute(
            select(OutfitItem.item_id).where(OutfitItem.outfit_id.in_(outfit_ids))
        ):
            wears[item_id] += 1
    single = (
        await db.execute(
            select(ItemHistory.item_id, ItemHistory.worn_at)
            .join(ClothingItem, ClothingItem.id == ItemHistory.item_id)
            .where(
                ClothingItem.user_id == user_id,
                ItemHistory.worn_at >= start,
                ItemHistory.worn_at <= until,
            )
        )
    ).all()
    for item_id, day in single:
        wears[item_id] += 1
        days.add(day)

    items = list(
        (
            await db.execute(
                select(ClothingItem).where(
                    ClothingItem.user_id == user_id, ClothingItem.is_archived.is_(False)
                )
            )
        ).scalars()
    )
    by_id = {i.id: i for i in items}
    worn_items = [by_id[i] for i in wears if i in by_id]

    top = [
        GarmentStat(item=by_id[i], count=n)
        for i, n in sorted(wears.items(), key=lambda kv: (-kv[1], str(kv[0])))
        if i in by_id
    ][:3]
    colors = Counter(
        by_id[i].primary_color for i, n in wears.items() if i in by_id for _ in range(n)
    )
    colors.pop(None, None)

    start_dt = datetime.combine(start, time.min, UTC)
    until_dt = datetime.combine(until + timedelta(days=1), time.min, UTC)
    added = [i for i in items if i.created_at and start_dt <= i.created_at < until_dt]
    by_way = Counter(i.created_via or "unknown" for i in added)

    cutoff = today - timedelta(days=FORGOTTEN_AFTER_DAYS)
    settled = datetime.combine(today - timedelta(days=30), time.min, UTC)
    forgotten = sorted(
        (
            i
            for i in items
            if (i.last_worn_at is None or i.last_worn_at < cutoff)
            and i.created_at
            and i.created_at < settled
        ),
        key=lambda i: (i.last_worn_at or date.min, str(i.id)),
    )

    priced = [i for i in items if i.purchase_price and i.purchase_price > 0]
    value = sum((Decimal(i.purchase_price) for i in priced), Decimal("0")) if priced else None
    worn_priced = [i for i in priced if (i.wear_count or 0) > 0]
    average = None
    if worn_priced:
        average = cost_per_wear(
            sum((Decimal(i.purchase_price) for i in worn_priced), Decimal("0")),
            sum(i.wear_count for i in worn_priced),
        )
    best = None
    if worn_priced:
        winner = min(worn_priced, key=lambda i: Decimal(i.purchase_price) / i.wear_count)
        best = GarmentStat(
            item=winner,
            count=winner.wear_count,
            cost_per_wear=cost_per_wear(winner.purchase_price, winner.wear_count),
        )

    return Wrapped(
        month=start,
        until=until,
        days_logged=len(days),
        looks_worn=len(outfit_ids),
        garments_worn=len(worn_items),
        wardrobe_size=len(items),
        top=top,
        top_color=colors.most_common(1)[0][0] if colors else None,
        added=len(added),
        added_by_way=dict(by_way),
        forgotten_count=len(forgotten),
        forgotten=[GarmentStat(item=i) for i in forgotten[:3]],
        wardrobe_value=value,
        average_cost_per_wear=average,
        best_value=best,
    )
