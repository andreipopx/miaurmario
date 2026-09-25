"""The two once-a-day alerts: «Tu look de la mañana» and «Movimiento de amigos».

Both go out at a local clock time the user picks (stored on
``NotificationPreference``), through the default channels (account email + Web
Push) that the user left on for that event. The per-minute cron in
``app.workers.notifications`` decides *when*; this module decides *what* and
writes the ``Notification`` rows that make a second delivery for the same day a
no-op — so a retried worker job never notifies twice.

Rules the owner asked for, in one place:

* The morning look reuses the day-moments/stylist path for moment 0, which
  falls back to the heuristic composer when the user has no AI. A day that
  already has an accepted or worn look is left alone, an existing pending
  suggestion is re-sent rather than regenerated, and a wardrobe too small to
  compose anything sends nothing at all (never a sad empty nudge).
* Friend activity is batched: at most one notification per user per day,
  covering everything since the previous digest. No activity, no notification.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.notification import Notification, NotificationStatus
from app.models.outfit import Outfit, OutfitRating, OutfitStatus, OutfitVisibility
from app.models.user import User
from app.services.access_control import accepted_friend_ids
from app.services.ai_service import AIDisabledError
from app.services.day_moments import DayMomentService, MomentRequest
from app.services.event_notifications import (
    default_channels_for,
    public_origin,
    send_default_channels,
)
from app.services.recommendation_service import InsufficientWardrobeError
from app.services.social_service import SOCIAL_SCOPES
from app.services.weather_service import WMO_LABEL_ES_UNKNOWN, wmo_condition_label_es
from app.services.web_push import PushPayload
from app.utils.email_templates import (
    RenderedEmail,
    render_friend_activity_email,
    render_morning_look_email,
)

logger = logging.getLogger(__name__)

MORNING_LOOK_EVENT = "morning_look"
FRIEND_ACTIVITY_EVENT = "friend_activity"

# One digest per day, with slack for DST shifts and a late cron tick: a digest
# sent 22 h ago still blocks a second one today.
FRIEND_ACTIVITY_MIN_GAP = timedelta(hours=20)
# How far back a digest ever looks, for an account that was quiet for weeks.
FRIEND_ACTIVITY_MAX_LOOKBACK = timedelta(days=7)

# Shared looks a friend can have in the feed.
SHARED_VISIBILITIES = (OutfitVisibility.friends, OutfitVisibility.public)

MAX_NAMES = 3


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #


async def load_alert_user(db: AsyncSession, user_id: UUID) -> User | None:
    """The active user with the relationships both alerts need."""
    return (
        await db.execute(
            select(User)
            .options(selectinload(User.preferences))
            .where(User.id == user_id, User.is_active.is_(True))
        )
    ).scalar_one_or_none()


async def already_notified_for_day(db: AsyncSession, user_id: UUID, event: str, day: date) -> bool:
    """True once any row for ``event`` on ``day`` exists (sent or failed alike).

    This is what makes the jobs idempotent: arq retries, a second cron tick
    inside the one-minute match window and a manual re-enqueue all stop here.
    """
    result = await db.execute(
        select(Notification.id)
        .where(
            Notification.user_id == user_id,
            Notification.payload["type"].astext == event,
            Notification.payload["day"].astext == day.isoformat(),
        )
        .limit(1)
    )
    return result.first() is not None


def _record(
    db: AsyncSession,
    *,
    user_id: UUID,
    event: str,
    day: date,
    results: list,
    payload_extra: dict | None = None,
    outfit_id: UUID | None = None,
) -> list[str]:
    now = datetime.now(UTC)
    payload = {"type": event, "day": day.isoformat(), **(payload_extra or {})}
    for r in results:
        db.add(
            Notification(
                user_id=user_id,
                outfit_id=outfit_id,
                channel=r.channel,
                status=NotificationStatus.sent if r.success else NotificationStatus.failed,
                payload=payload,
                attempts=1,
                last_attempt_at=now,
                sent_at=now if r.success else None,
                error_message=r.error,
            )
        )
    return [r.channel for r in results if r.success]


def _no_op_marker(db: AsyncSession, user_id: UUID, event: str, day: date, reason: str) -> None:
    """Remember that we deliberately said nothing today.

    Keeps a retried job (and the next cron tick a minute later) from composing
    the whole thing again, and keeps the digest window anchored.
    """
    db.add(
        Notification(
            user_id=user_id,
            channel="none",
            status=NotificationStatus.sent,
            payload={"type": event, "day": day.isoformat(), "skipped": reason},
            attempts=0,
            sent_at=datetime.now(UTC),
        )
    )


# --------------------------------------------------------------------------- #
# «Tu look de la mañana»
# --------------------------------------------------------------------------- #


def _soften(name: str) -> str:
    """Drop a leading capital so the pieces read as a sentence.

    Item names are stored capitalised ("Vaqueros"), but they land mid-line here.
    A shouty first word ("NIKE air") is left as the user typed it.
    """
    first_word = name.split(" ", 1)[0]
    if len(first_word) > 1 and first_word[1:].isupper():
        return name
    return name[:1].lower() + name[1:]


def outfit_item_names(outfit: Outfit) -> list[str]:
    names: list[str] = []
    for oi in sorted(outfit.items, key=lambda x: x.position):
        item = oi.item
        if item is None:
            continue
        label = (item.name or item.type or "").strip()
        if label:
            names.append(_soften(label))
    return names


def _join_es(parts: list[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " y " + parts[-1]


def weather_phrase(weather: dict | None) -> str:
    """ "9 °C y lluvia" from an outfit's stored weather snapshot ("" if unknown)."""
    if not weather:
        return ""
    parts: list[str] = []
    temperature = weather.get("temperature")
    if temperature is not None:
        try:
            parts.append(f"{round(float(temperature))} °C")
        except (TypeError, ValueError):
            pass
    label = weather.get("condition_label") or wmo_condition_label_es(weather.get("condition_code"))
    if label and label != WMO_LABEL_ES_UNKNOWN:
        parts.append(label.lower())
    return " y ".join(parts)


def morning_look_line(outfit: Outfit) -> str:
    """The whole notification in one line: "9 °C y lluvia: vaqueros, jersey y botas"."""
    items = _join_es(outfit_item_names(outfit))
    weather = weather_phrase(outfit.weather_data)
    if weather and items:
        return f"{weather}: {items}"
    return items or weather


def _is_settled(outfit: Outfit | None, worn: bool) -> bool:
    """The user already decided what to wear: don't touch their day."""
    return worn or (outfit is not None and outfit.status == OutfitStatus.accepted)


async def send_morning_look(db: AsyncSession, user_id: UUID, day: date) -> dict:
    """Today's suggestion for moment 0, as one line. Flushes; caller commits."""
    user = await load_alert_user(db, user_id)
    if user is None:
        return {"status": "skipped", "reason": "user_not_found"}
    if await already_notified_for_day(db, user_id, MORNING_LOOK_EVENT, day):
        return {"status": "skipped", "reason": "already_sent"}

    channels = await default_channels_for(db, user, MORNING_LOOK_EVENT)
    if not channels:
        return {"status": "skipped", "reason": "no_channel"}

    service = DayMomentService(db)
    moments = await service.get_day(user.id, day)
    first = next((m for m in moments if m.order == 0), None)
    if first is not None and _is_settled(first.outfit, first.is_worn):
        return {"status": "skipped", "reason": "already_decided"}

    outfit = first.outfit if first is not None else None
    if outfit is None:
        try:
            outfit = (await service.suggest(user, day, MomentRequest(order=0))).outfit
        except InsufficientWardrobeError:
            # Too few items to compose anything: say nothing at all.
            _no_op_marker(db, user_id, MORNING_LOOK_EVENT, day, "wardrobe_too_small")
            await db.flush()
            return {"status": "skipped", "reason": "wardrobe_too_small"}
        except ValueError as exc:
            # No weather, no candidate items after filters, bad preferences...
            logger.info("No morning look for user %s: %s", user_id, exc)
            _no_op_marker(db, user_id, MORNING_LOOK_EVENT, day, "cannot_compose")
            await db.flush()
            return {"status": "skipped", "reason": "cannot_compose"}
        except AIDisabledError:
            # suggest() already falls back to the heuristic; a leak means no look.
            _no_op_marker(db, user_id, MORNING_LOOK_EVENT, day, "no_engine")
            await db.flush()
            return {"status": "skipped", "reason": "no_engine"}

    line = morning_look_line(outfit)
    if not line:
        _no_op_marker(db, user_id, MORNING_LOOK_EVENT, day, "nothing_to_say")
        await db.flush()
        return {"status": "skipped", "reason": "nothing_to_say"}

    cta_url = f"{public_origin()}/dashboard"

    def render(unsubscribe_url: str) -> RenderedEmail:
        return render_morning_look_email(
            line=line,
            items=outfit_item_names(outfit),
            cta_url=cta_url,
            unsubscribe_url=unsubscribe_url,
        )

    results = await send_default_channels(
        db,
        user=user,
        event=MORNING_LOOK_EVENT,
        render_email=render,
        push=PushPayload(
            title="Tu look de la mañana",
            body=line[:180],
            url="/dashboard",
            tag=f"morning-look-{day.isoformat()}",
        ),
    )
    sent = _record(
        db,
        user_id=user_id,
        event=MORNING_LOOK_EVENT,
        day=day,
        results=results,
        payload_extra={"line": line},
        outfit_id=outfit.id,
    )
    await db.flush()
    return {
        "status": "sent" if sent else "no_channel",
        "channels": sent,
        "outfit_id": str(outfit.id),
    }


# --------------------------------------------------------------------------- #
# «Movimiento de amigos»
# --------------------------------------------------------------------------- #


@dataclass
class FriendActivity:
    reacted: list[str] = field(default_factory=list)  # usernames, most recent first
    shared: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.reacted and not self.shared


def _names(usernames: list[str]) -> str:
    shown = [f"@{u}" for u in usernames[:MAX_NAMES]]
    extra = len(usernames) - len(shown)
    if extra > 0:
        return ", ".join(shown) + f" y {extra} más"
    return _join_es(shown)


def friend_activity_lines(activity: FriendActivity) -> list[str]:
    """One short line per kind: "@lucia y @ana han reaccionado a tu look"."""
    lines: list[str] = []
    if activity.reacted:
        verb = "ha" if len(activity.reacted) == 1 else "han"
        lines.append(f"{_names(activity.reacted)} {verb} reaccionado a tu look")
    if activity.shared:
        if len(activity.shared) == 1:
            lines.append(f"{_names(activity.shared)} ha compartido el suyo")
        else:
            lines.append(f"{_names(activity.shared)} han compartido los suyos")
    return lines


async def last_friend_activity_at(db: AsyncSession, user_id: UUID) -> datetime | None:
    """When the previous digest went out (or was deliberately skipped)."""
    result = await db.execute(
        select(func.max(Notification.created_at)).where(
            Notification.user_id == user_id,
            Notification.payload["type"].astext == FRIEND_ACTIVITY_EVENT,
        )
    )
    return result.scalar_one_or_none()


async def collect_friend_activity(db: AsyncSession, user: User, since: datetime) -> FriendActivity:
    """Reactions to my looks and friends' new shared looks since ``since``."""
    reacted_stmt = (
        select(User.username, func.max(OutfitRating.updated_at).label("last"))
        .join(Outfit, Outfit.id == OutfitRating.outfit_id)
        .join(User, User.id == OutfitRating.user_id)
        .where(
            Outfit.user_id == user.id,
            OutfitRating.user_id != user.id,
            OutfitRating.scope.in_(SOCIAL_SCOPES),
            OutfitRating.updated_at >= since,
            User.is_active.is_(True),
            User.username.is_not(None),
        )
        .group_by(User.username)
        .order_by(func.max(OutfitRating.updated_at).desc())
    )
    reacted = [row[0] for row in (await db.execute(reacted_stmt)).all()]

    friend_ids = await accepted_friend_ids(db, user.id)
    shared: list[str] = []
    if friend_ids:
        shared_stmt = (
            select(User.username, func.max(Outfit.shared_at).label("last"))
            .join(User, User.id == Outfit.user_id)
            .where(
                Outfit.user_id.in_(friend_ids),
                Outfit.visibility.in_(SHARED_VISIBILITIES),
                Outfit.shared_at.is_not(None),
                Outfit.shared_at >= since,
                User.is_active.is_(True),
                User.username.is_not(None),
            )
            .group_by(User.username)
            .order_by(func.max(Outfit.shared_at).desc())
        )
        shared = [row[0] for row in (await db.execute(shared_stmt)).all()]

    return FriendActivity(reacted=reacted, shared=shared)


async def send_friend_activity(db: AsyncSession, user_id: UUID, day: date) -> dict:
    """The day's batched friend digest. Flushes; caller commits."""
    user = await load_alert_user(db, user_id)
    if user is None:
        return {"status": "skipped", "reason": "user_not_found"}
    if await already_notified_for_day(db, user_id, FRIEND_ACTIVITY_EVENT, day):
        return {"status": "skipped", "reason": "already_sent"}

    now = datetime.now(UTC)
    previous = await last_friend_activity_at(db, user_id)
    if previous is not None:
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=UTC)
        if now - previous < FRIEND_ACTIVITY_MIN_GAP:
            return {"status": "skipped", "reason": "batched_today"}

    channels = await default_channels_for(db, user, FRIEND_ACTIVITY_EVENT)
    if not channels:
        return {"status": "skipped", "reason": "no_channel"}

    floor = now - FRIEND_ACTIVITY_MAX_LOOKBACK
    since = max(previous, floor) if previous is not None else max(now - timedelta(days=1), floor)
    activity = await collect_friend_activity(db, user, since)
    if activity.empty:
        # Nothing happened: no notification, and no marker either, so tomorrow's
        # digest still covers everything since the last one that did go out.
        return {"status": "skipped", "reason": "no_activity"}

    lines = friend_activity_lines(activity)
    body = " · ".join(lines)
    cta_url = f"{public_origin()}/dashboard/friends"

    def render(unsubscribe_url: str) -> RenderedEmail:
        return render_friend_activity_email(
            lines=lines, cta_url=cta_url, unsubscribe_url=unsubscribe_url
        )

    results = await send_default_channels(
        db,
        user=user,
        event=FRIEND_ACTIVITY_EVENT,
        render_email=render,
        push=PushPayload(
            title="Movimiento de amigos",
            body=body[:180],
            url="/dashboard/friends",
            tag=f"friend-activity-{day.isoformat()}",
        ),
    )
    sent = _record(
        db,
        user_id=user_id,
        event=FRIEND_ACTIVITY_EVENT,
        day=day,
        results=results,
        payload_extra={
            "reacted": activity.reacted[:10],
            "shared": activity.shared[:10],
            "body": body,
        },
    )
    await db.flush()
    return {"status": "sent" if sent else "no_channel", "channels": sent, "lines": lines}


__all__ = [
    "FRIEND_ACTIVITY_EVENT",
    "MORNING_LOOK_EVENT",
    "FriendActivity",
    "already_notified_for_day",
    "collect_friend_activity",
    "friend_activity_lines",
    "morning_look_line",
    "outfit_item_names",
    "send_friend_activity",
    "send_morning_look",
    "weather_phrase",
]
