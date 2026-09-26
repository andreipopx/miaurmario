"""Outfit sharing, friends' feed and reactions (social layer).

Sharing is per outfit (`visibility` friends/public). A user may share several
outfits on the same day (e.g. work in the morning, a date at night); the feed
groups them per author and day, ordered inside the group by day moment
(`Outfit.moment_order`, then its time) and then by when they were accepted/created.
"""

import base64
import binascii
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import Date, and_, cast, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem
from app.models.outfit import Outfit, OutfitItem, OutfitRating, OutfitVisibility, RatingScope
from app.models.user import User

SOCIAL_SCOPES = (RatingScope.friend, RatingScope.public)

# The day an outfit belongs to in the feed: the day it's for, else the day it was shared.
FEED_DAY = func.coalesce(Outfit.scheduled_for, cast(func.timezone("UTC", Outfit.shared_at), Date))


def feed_day(outfit: Outfit) -> date | None:
    """Python twin of FEED_DAY."""
    if outfit.scheduled_for is not None:
        return outfit.scheduled_for
    return outfit.shared_at.astimezone(UTC).date() if outfit.shared_at else None


class InvalidCursorError(ValueError):
    pass


def apply_visibility(outfit: Outfit, visibility: OutfitVisibility) -> None:
    """Set visibility, keeping `shared_at` consistent."""
    outfit.visibility = visibility
    if visibility == OutfitVisibility.private:
        outfit.shared_at = None
    elif outfit.shared_at is None:
        outfit.shared_at = datetime.now(UTC)


def share_with_friends(outfit: Outfit) -> None:
    """Share with friends: private → friends (public stays public); bumps `shared_at`."""
    if outfit.visibility == OutfitVisibility.private:
        outfit.visibility = OutfitVisibility.friends
    outfit.shared_at = datetime.now(UTC)


def _b64(obj: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def _unb64(cursor: str) -> dict:
    padding = "=" * (-len(cursor) % 4)
    try:
        obj = json.loads(base64.urlsafe_b64decode(cursor + padding))
    except (binascii.Error, ValueError, TypeError) as exc:
        raise InvalidCursorError() from exc
    if not isinstance(obj, dict):
        raise InvalidCursorError()
    return obj


def _within_day_order():
    # Day moments first (morning look before the evening one), then chronological.
    return (
        Outfit.moment_order.asc(),
        Outfit.moment_time.asc().nulls_last(),
        func.coalesce(Outfit.responded_at, Outfit.created_at).asc(),
        Outfit.id.asc(),
    )


def _base_filters(owner_ids: list[UUID], visibilities: tuple[OutfitVisibility, ...]):
    return (
        Outfit.user_id.in_(owner_ids),
        Outfit.visibility.in_(visibilities),
        Outfit.shared_at.is_not(None),
        User.is_active.is_(True),
    )


def _load_options():
    return (
        selectinload(Outfit.items)
        .selectinload(OutfitItem.item)
        .selectinload(ClothingItem.additional_images),
        selectinload(Outfit.user),
    )


@dataclass
class DayGroup:
    user_id: UUID
    day: date
    last_shared_at: datetime
    outfits: list[Outfit] = field(default_factory=list)


async def list_feed_groups(
    db: AsyncSession,
    *,
    owner_ids: list[UUID],
    visibilities: tuple[OutfitVisibility, ...],
    limit: int,
    cursor: str | None,
) -> tuple[list[DayGroup], str | None]:
    """Shared outfits grouped per (author, day): newest day first, then most recent share."""
    if not owner_ids or not visibilities:
        return [], None
    last_shared = func.max(Outfit.shared_at)
    stmt = (
        select(Outfit.user_id, FEED_DAY, last_shared)
        .join(User, User.id == Outfit.user_id)
        .where(*_base_filters(owner_ids, visibilities))
        .group_by(Outfit.user_id, FEED_DAY)
        .order_by(FEED_DAY.desc(), last_shared.desc(), Outfit.user_id.desc())
        .limit(limit + 1)
    )
    if cursor:
        c = _unb64(cursor)
        try:
            c_day = date.fromisoformat(c["d"])
            c_last = datetime.fromisoformat(c["s"])
            c_user = UUID(c["u"])
        except (KeyError, ValueError, TypeError) as exc:
            raise InvalidCursorError() from exc
        stmt = stmt.having(tuple_(FEED_DAY, last_shared, Outfit.user_id) < (c_day, c_last, c_user))
    rows = (await db.execute(stmt)).all()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        u, d, s = rows[-1]
        next_cursor = _b64({"d": d.isoformat(), "s": s.isoformat(), "u": str(u)})
    groups = [DayGroup(user_id=u, day=d, last_shared_at=s) for u, d, s in rows]
    if not groups:
        return [], None

    outfits_stmt = (
        select(Outfit)
        .join(User, User.id == Outfit.user_id)
        .where(
            *_base_filters(owner_ids, visibilities),
            or_(*[and_(Outfit.user_id == g.user_id, FEED_DAY == g.day) for g in groups]),
        )
        .options(*_load_options())
        .order_by(*_within_day_order())
    )
    by_key = {(g.user_id, g.day): g for g in groups}
    for o in (await db.execute(outfits_stmt)).scalars().unique().all():
        g = by_key.get((o.user_id, feed_day(o)))
        if g is not None:
            g.outfits.append(o)
    return [g for g in groups if g.outfits], next_cursor


async def list_shared_outfits(
    db: AsyncSession,
    *,
    owner_ids: list[UUID],
    visibilities: tuple[OutfitVisibility, ...],
    limit: int,
    cursor: str | None,
) -> tuple[list[Outfit], str | None]:
    """Flat list (profile grid): newest share first, keyset-paginated."""
    if not owner_ids or not visibilities:
        return [], None
    stmt = (
        select(Outfit)
        .join(User, User.id == Outfit.user_id)
        .where(*_base_filters(owner_ids, visibilities))
        .options(*_load_options())
        .order_by(Outfit.shared_at.desc(), Outfit.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        c = _unb64(cursor)
        try:
            c_shared = datetime.fromisoformat(c["s"])
            c_id = UUID(c["i"])
        except (KeyError, ValueError, TypeError) as exc:
            raise InvalidCursorError() from exc
        stmt = stmt.where(
            or_(
                Outfit.shared_at < c_shared,
                and_(Outfit.shared_at == c_shared, Outfit.id < c_id),
            )
        )
    rows = list((await db.execute(stmt)).scalars().unique().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        assert last.shared_at is not None
        next_cursor = _b64({"s": last.shared_at.isoformat(), "i": str(last.id)})
    return rows, next_cursor


@dataclass
class ReactionStats:
    count: int = 0
    comment_count: int = 0


async def reaction_stats(db: AsyncSession, outfit_ids: list[UUID]) -> dict[UUID, ReactionStats]:
    if not outfit_ids:
        return {}
    stmt = (
        select(
            OutfitRating.outfit_id,
            func.count(OutfitRating.id),
            func.count(OutfitRating.comment),
        )
        .where(OutfitRating.outfit_id.in_(outfit_ids), OutfitRating.scope.in_(SOCIAL_SCOPES))
        .group_by(OutfitRating.outfit_id)
    )
    return {
        oid: ReactionStats(count=int(n), comment_count=int(c))
        for oid, n, c in (await db.execute(stmt)).all()
    }


async def my_reactions(
    db: AsyncSession, user_id: UUID, outfit_ids: list[UUID]
) -> dict[UUID, OutfitRating]:
    if not outfit_ids:
        return {}
    stmt = select(OutfitRating).where(
        OutfitRating.user_id == user_id,
        OutfitRating.outfit_id.in_(outfit_ids),
        OutfitRating.scope.in_(SOCIAL_SCOPES),
    )
    return {r.outfit_id: r for r in (await db.execute(stmt)).scalars().all()}


async def unseen_reaction_count(db: AsyncSession, user: User) -> int:
    stmt = (
        select(func.count(OutfitRating.id))
        .join(Outfit, Outfit.id == OutfitRating.outfit_id)
        .where(
            Outfit.user_id == user.id,
            OutfitRating.scope.in_(SOCIAL_SCOPES),
            OutfitRating.user_id != user.id,
        )
    )
    if user.social_seen_at is not None:
        stmt = stmt.where(OutfitRating.updated_at > user.social_seen_at)
    return int((await db.execute(stmt)).scalar_one())
