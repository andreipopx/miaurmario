"""Web Push (VAPID) delivery to the user's subscribed browsers/devices.

pywebpush is synchronous (requests), so every send runs in a worker thread.
Subscriptions the push service reports as gone (404/410) are deleted.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.notification import PushSubscription

logger = logging.getLogger(__name__)

# Stinky icon + monochrome badge (paths on the web origin; the SW resolves them).
PUSH_ICON = "/icon-192.png"
PUSH_BADGE = "/brand/stinky/badge-96.png"

_GONE_STATUSES = {404, 410}


@dataclass
class PushPayload:
    title: str
    body: str
    url: str = "/dashboard"
    tag: str | None = None

    def to_json(self) -> str:
        data = {
            "title": self.title,
            "body": self.body,
            "url": self.url,
            "icon": PUSH_ICON,
            "badge": PUSH_BADGE,
        }
        if self.tag:
            data["tag"] = self.tag
        return json.dumps(data, ensure_ascii=False)


@dataclass
class PushResult:
    sent: int = 0
    removed: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return self.sent > 0


def push_available() -> bool:
    return get_settings().web_push_enabled


def _send_one_sync(sub: dict, data: str, ttl: int) -> int:
    """Returns the HTTP status (201 on success). Raises on transport errors."""
    from pywebpush import WebPushException, webpush

    settings = get_settings()
    try:
        resp = webpush(
            subscription_info=sub,
            data=data,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=ttl,
            timeout=10,
        )
        return getattr(resp, "status_code", 201)
    except WebPushException as exc:
        if exc.response is not None:
            return exc.response.status_code
        raise


async def list_subscriptions(db: AsyncSession, user_id: UUID) -> list[PushSubscription]:
    result = await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))
    return list(result.scalars().all())


async def send_web_push(
    db: AsyncSession, user_id: UUID, payload: PushPayload, *, ttl: int = 12 * 3600
) -> PushResult:
    """Push to every subscription of ``user_id``. Flushes (caller commits)."""
    result = PushResult()
    if not push_available():
        return result
    subs = await list_subscriptions(db, user_id)
    data = payload.to_json()
    now = datetime.now(UTC)
    for sub in subs:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        try:
            status = await asyncio.to_thread(_send_one_sync, info, data, ttl)
        except Exception as exc:  # network error, bad key material...
            logger.warning("Web push to subscription %s failed: %s", sub.id, exc)
            result.failed += 1
            result.errors.append(str(exc))
            continue
        if 200 <= status < 300:
            sub.last_used_at = now
            result.sent += 1
        elif status in _GONE_STATUSES:
            await db.execute(delete(PushSubscription).where(PushSubscription.id == sub.id))
            result.removed += 1
        else:
            logger.warning("Web push to subscription %s rejected: HTTP %s", sub.id, status)
            result.failed += 1
            result.errors.append(f"HTTP {status}")
    await db.flush()
    return result
