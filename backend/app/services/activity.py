"""«Came back today»: one row per user per day of use, for the activation funnel.

Recorded after the response (a background task off the auth dependency), at most
once per user per day: an in-process set skips the work on every later request,
and a Redis key keeps the other workers from repeating the insert. Losing a day
to a hiccup is fine — this is a trend, not a ledger — so nothing here can fail
a request.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import async_session_maker
from app.models.activity import UserActivityDay
from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)

_seen: set[tuple[uuid.UUID, date]] = set()
_MAX_SEEN = 20_000


def _today() -> date:
    return datetime.now(UTC).date()


def already_recorded(user_id: uuid.UUID) -> bool:
    """True when this process already wrote today's row for the user."""
    return (user_id, _today()) in _seen


async def record_activity(user_id: uuid.UUID) -> None:
    today = _today()
    if (user_id, today) in _seen:
        return
    if len(_seen) >= _MAX_SEEN:
        _seen.clear()
    _seen.add((user_id, today))
    try:
        redis = await get_redis()
        if not await redis.set(
            f"activity:{user_id}:{today.isoformat()}", "1", nx=True, ex=2 * 86400
        ):
            return
    except Exception:  # no Redis: the in-process set still keeps it to once per worker
        pass
    try:
        async with async_session_maker() as session:
            await session.execute(
                pg_insert(UserActivityDay)
                .values(user_id=user_id, day=today)
                .on_conflict_do_nothing()
            )
            await session.commit()
    except Exception as e:
        logger.debug("Activity day not recorded: %s", type(e).__name__)
