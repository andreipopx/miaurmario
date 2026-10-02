"""One push to every device of a user: browsers (Web Push) and the native app.

Callers think in terms of "the push channel"; whether a given phone is a home
screen PWA or the Android/iOS app is a detail handled here.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NativePushToken, PushSubscription
from app.services.native_push import (
    PLATFORMS,
    native_push_available,
    platform_available,
    send_native_push,
)
from app.services.web_push import PushPayload, PushResult, push_available, send_web_push

logger = logging.getLogger(__name__)


def any_push_available() -> bool:
    return push_available() or native_push_available()


def native_platforms_available() -> list[str]:
    return [p for p in PLATFORMS if platform_available(p)]


async def count_push_devices(db: AsyncSession, user_id: UUID) -> int:
    """Devices that a push sent right now would actually be tried on."""
    total = 0
    if push_available():
        total += (
            await db.execute(
                select(func.count(PushSubscription.id)).where(PushSubscription.user_id == user_id)
            )
        ).scalar_one()
    platforms = native_platforms_available()
    if platforms:
        total += (
            await db.execute(
                select(func.count(NativePushToken.id)).where(
                    NativePushToken.user_id == user_id,
                    NativePushToken.platform.in_(platforms),
                )
            )
        ).scalar_one()
    return int(total)


async def has_push_device(db: AsyncSession, user_id: UUID) -> bool:
    return await count_push_devices(db, user_id) > 0


async def send_push(
    db: AsyncSession, user_id: UUID, payload: PushPayload, *, ttl: int = 12 * 3600
) -> PushResult:
    """Web Push and native push together. Flushes (caller commits)."""
    total = PushResult()
    for name, sender in (("web", send_web_push), ("native", send_native_push)):
        try:
            part = await sender(db, user_id, payload, ttl=ttl)
        except Exception as exc:  # e.g. a malformed key: don't lose the other half
            logger.warning("%s push to user %s failed: %s", name, user_id, exc)
            total.failed += 1
            total.errors.append(str(exc)[:300])
            continue
        total.sent += part.sent
        total.removed += part.removed
        total.failed += part.failed
        total.errors.extend(part.errors)
    return total
