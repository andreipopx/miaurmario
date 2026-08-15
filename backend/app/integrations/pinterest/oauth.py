"""Pinterest OAuth authorization_code flow.

State is stored in Redis with a 10-minute TTL and bound to the requesting
user_id, so a leaked authorize URL cannot be replayed against another account.
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from arq import create_pool

from app.config import get_settings
from app.workers.settings import get_redis_settings

AUTHORIZE_URL = "https://www.pinterest.com/oauth/"
TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"
DEFAULT_SCOPES = "boards:read,pins:read"
STATE_TTL_SECONDS = 600
STATE_KEY_PREFIX = "pinterest:oauth:state:"


class OAuthStateError(RuntimeError):
    pass


async def create_state(user_id: str) -> str:
    """Generate a fresh CSRF state token and stash it in Redis bound to user_id."""
    state = secrets.token_urlsafe(32)
    redis = await create_pool(get_redis_settings())
    try:
        await redis.set(f"{STATE_KEY_PREFIX}{state}", user_id, ex=STATE_TTL_SECONDS)
    finally:
        await redis.aclose()
    return state


async def consume_state(state: str) -> str:
    """Validate the state token, return the user_id it was created for, and delete it."""
    key = f"{STATE_KEY_PREFIX}{state}"
    redis = await create_pool(get_redis_settings())
    try:
        raw = await redis.get(key)
        if raw is None:
            raise OAuthStateError("state token is missing, expired, or already consumed")
        await redis.delete(key)
    finally:
        await redis.aclose()
    return raw.decode() if isinstance(raw, (bytes, bytearray)) else str(raw)


def build_authorize_url(state: str, scopes: str = DEFAULT_SCOPES) -> str:
    settings = get_settings()
    params = {
        "response_type": "code",
        "client_id": settings.pinterest_client_id or "",
        "redirect_uri": settings.pinterest_redirect_uri,
        "scope": scopes,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict[str, Any]:
    """Trade the authorization code for access + refresh tokens."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.pinterest_redirect_uri,
            },
            auth=(settings.pinterest_client_id or "", settings.pinterest_client_secret or ""),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code >= 400:
        raise OAuthStateError(f"Pinterest token exchange failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    now = datetime.now(UTC)
    payload["access_token_expires_at"] = now + timedelta(seconds=payload.get("expires_in", 3600))
    # Refresh tokens issued by v5 are "continuous" — usable for 60 days, and each use
    # rolls the clock forward. Store the outer bound so the cron can renew before it lapses.
    payload["refresh_token_expires_at"] = now + timedelta(days=60)
    return payload
