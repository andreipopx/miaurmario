"""Push to the native app: Android through FCM (HTTP v1), iPhone through APNs.

The app is a Capacitor shell whose WebView can't use Web Push, so on start it
registers the token its OS issued (``NativePushToken``). Both providers take a
short-lived bearer token we sign ourselves with PyJWT, so there's no Google or
Apple SDK here, only httpx (HTTP/2 for APNs, which accepts nothing else).

Tokens the provider reports as dead are deleted, like expired Web Push
subscriptions in :mod:`app.services.web_push`.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.notification import NativePushToken
from app.services.web_push import PushPayload, PushResult

logger = logging.getLogger(__name__)

PLATFORM_ANDROID = "android"
PLATFORM_IOS = "ios"
PLATFORMS = (PLATFORM_ANDROID, PLATFORM_IOS)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
APNS_HOST = "https://api.push.apple.com"
APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com"

# Pink of the brand, for the Android notification accent.
NOTIFICATION_COLOR = "#FF7EB6"

# Refresh the signed bearer tokens well before their 60-minute lifetime ends.
_TOKEN_MAX_AGE = 45 * 60


class DeadToken(Exception):
    """The provider says this device token will never work again."""


def native_push_available() -> bool:
    return get_settings().native_push_enabled


def platform_available(platform: str) -> bool:
    settings = get_settings()
    if platform == PLATFORM_ANDROID:
        return settings.fcm_enabled
    if platform == PLATFORM_IOS:
        return settings.apns_enabled
    return False


def _secret(value: str) -> str:
    """A secret given inline, with ``\\n`` escapes from a one-line .env, or as a file path."""
    text = value.strip()
    if text.startswith("{"):
        # JSON is one line already; its own \n escapes are decoded by json.loads.
        return text
    if text.startswith("-----BEGIN"):
        return text.replace("\\n", "\n")
    return Path(text).read_text()


# --------------------------------------------------------------------------- #
# Payloads
# --------------------------------------------------------------------------- #


def fcm_message(token: str, payload: PushPayload, ttl: int) -> dict[str, Any]:
    data = {"url": payload.url}
    if payload.tag:
        data["tag"] = payload.tag
    android_notification: dict[str, Any] = {
        "color": NOTIFICATION_COLOR,
        "icon": "ic_stat_stinky",
        "sound": "default",
    }
    if payload.tag:
        # Same tag replaces the previous notification instead of stacking.
        android_notification["tag"] = payload.tag
    return {
        "message": {
            "token": token,
            "notification": {"title": payload.title, "body": payload.body},
            # FCM data values must all be strings.
            "data": data,
            "android": {
                "priority": "high",
                "ttl": f"{ttl}s",
                "notification": android_notification,
            },
        }
    }


def apns_body(payload: PushPayload) -> dict[str, Any]:
    body: dict[str, Any] = {
        "aps": {
            "alert": {"title": payload.title, "body": payload.body},
            "sound": "default",
        },
        "url": payload.url,
    }
    if payload.tag:
        body["aps"]["thread-id"] = payload.tag
        body["tag"] = payload.tag
    return body


def apns_headers(payload: PushPayload, ttl: int, bearer: str) -> dict[str, str]:
    settings = get_settings()
    headers = {
        "authorization": f"bearer {bearer}",
        "apns-topic": settings.apns_bundle_id,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": str(int(time.time()) + ttl),
    }
    if payload.tag:
        # Same collapse id replaces the previous notification (max 64 bytes).
        headers["apns-collapse-id"] = payload.tag.encode()[:64].decode(errors="ignore")
    return headers


# --------------------------------------------------------------------------- #
# Credentials (signed bearer tokens, cached per process)
# --------------------------------------------------------------------------- #


@dataclass
class _Cached:
    value: str
    minted_at: float


_fcm_access: _Cached | None = None
_apns_bearer: _Cached | None = None


def _fresh(cached: _Cached | None) -> bool:
    return cached is not None and time.time() - cached.minted_at < _TOKEN_MAX_AGE


def fcm_service_account() -> dict[str, Any]:
    raw = get_settings().fcm_service_account_json
    if not raw:
        raise RuntimeError("FCM is not configured")
    return json.loads(_secret(raw))


async def _fcm_access_token(client: httpx.AsyncClient) -> str:
    """Exchange a JWT signed with the service account key for an OAuth token."""
    global _fcm_access
    if _fresh(_fcm_access):
        return _fcm_access.value  # type: ignore[union-attr]
    account = fcm_service_account()
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": account["client_email"],
            "scope": FCM_SCOPE,
            "aud": account.get("token_uri", GOOGLE_TOKEN_URL),
            "iat": now,
            "exp": now + 3600,
        },
        account["private_key"],
        algorithm="RS256",
    )
    resp = await client.post(
        account.get("token_uri", GOOGLE_TOKEN_URL),
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=10,
    )
    resp.raise_for_status()
    _fcm_access = _Cached(resp.json()["access_token"], time.time())
    return _fcm_access.value


def _apns_bearer_token() -> str:
    global _apns_bearer
    if _fresh(_apns_bearer):
        return _apns_bearer.value  # type: ignore[union-attr]
    settings = get_settings()
    token = jwt.encode(
        {"iss": settings.apns_team_id, "iat": int(time.time())},
        _secret(settings.apns_private_key or ""),
        algorithm="ES256",
        headers={"kid": settings.apns_key_id},
    )
    _apns_bearer = _Cached(token, time.time())
    return token


def reset_credentials_cache() -> None:
    """Forget minted bearer tokens (tests; or after rotating a key)."""
    global _fcm_access, _apns_bearer
    _fcm_access = None
    _apns_bearer = None


# --------------------------------------------------------------------------- #
# Sending
# --------------------------------------------------------------------------- #


async def send_fcm(client: httpx.AsyncClient, token: str, payload: PushPayload, ttl: int) -> None:
    project_id = fcm_service_account()["project_id"]
    access = await _fcm_access_token(client)
    resp = await client.post(
        f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send",
        json=fcm_message(token, payload, ttl),
        headers={"authorization": f"Bearer {access}"},
        timeout=10,
    )
    if resp.status_code == 200:
        return
    detail = resp.text[:300]
    # UNREGISTERED (404) or a token FCM can't parse (400 INVALID_ARGUMENT on the token).
    if resp.status_code == 404 or (
        resp.status_code == 400 and "registration token" in detail.lower()
    ):
        raise DeadToken(detail)
    raise RuntimeError(f"FCM HTTP {resp.status_code}: {detail}")


async def send_apns(client: httpx.AsyncClient, token: str, payload: PushPayload, ttl: int) -> None:
    settings = get_settings()
    host = APNS_SANDBOX_HOST if settings.apns_use_sandbox else APNS_HOST
    resp = await client.post(
        f"{host}/3/device/{token}",
        json=apns_body(payload),
        headers=apns_headers(payload, ttl, _apns_bearer_token()),
        timeout=10,
    )
    if resp.status_code == 200:
        return
    reason = ""
    try:
        reason = resp.json().get("reason", "")
    except ValueError:
        pass
    if resp.status_code == 410 or reason in {
        "BadDeviceToken",
        "Unregistered",
        "DeviceTokenNotForTopic",
    }:
        raise DeadToken(reason or f"HTTP {resp.status_code}")
    raise RuntimeError(f"APNs HTTP {resp.status_code}: {reason or resp.text[:200]}")


def _client() -> httpx.AsyncClient:
    # APNs only speaks HTTP/2; FCM and Google's token endpoint are fine with it too.
    return httpx.AsyncClient(http2=True)


async def list_tokens(db: AsyncSession, user_id: UUID) -> list[NativePushToken]:
    result = await db.execute(select(NativePushToken).where(NativePushToken.user_id == user_id))
    return list(result.scalars().all())


async def send_native_push(
    db: AsyncSession,
    user_id: UUID,
    payload: PushPayload,
    *,
    ttl: int = 12 * 3600,
    client: httpx.AsyncClient | None = None,
) -> PushResult:
    """Push to every app install of ``user_id``. Flushes (caller commits)."""
    result = PushResult()
    if not native_push_available():
        return result
    tokens = [t for t in await list_tokens(db, user_id) if platform_available(t.platform)]
    if not tokens:
        return result
    own_client = client is None
    http = client or _client()
    now = datetime.now(UTC)
    try:
        for device in tokens:
            sender = send_fcm if device.platform == PLATFORM_ANDROID else send_apns
            try:
                await sender(http, device.token, payload, ttl)
            except DeadToken as exc:
                logger.info("Native push token %s is gone (%s); removing", device.id, exc)
                await db.execute(delete(NativePushToken).where(NativePushToken.id == device.id))
                result.removed += 1
                continue
            except Exception as exc:
                logger.warning("Native push to %s failed: %s", device.id, exc)
                result.failed += 1
                result.errors.append(str(exc)[:300])
                continue
            device.last_used_at = now
            result.sent += 1
    finally:
        if own_client:
            await http.aclose()
    await db.flush()
    return result
