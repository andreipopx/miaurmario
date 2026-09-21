"""Pinterest OAuth authorization_code flow.

State is stored in Redis (shared integrations state store) with a 10-minute
TTL and bound to the requesting user_id, so a leaked authorize URL cannot be
replayed against another account.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings
from app.integrations import state as state_store
from app.integrations.state import OAuthStateError

AUTHORIZE_URL = "https://www.pinterest.com/oauth/"
TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"
DEFAULT_SCOPES = "boards:read,pins:read"
PROVIDER = "pinterest"

__all__ = [
    "OAuthStateError",
    "build_authorize_url",
    "consume_state",
    "create_state",
    "exchange_code",
]


async def create_state(user_id: str) -> str:
    """Generate a fresh CSRF state token and stash it in Redis bound to user_id."""
    return await state_store.create_state(PROVIDER, user_id)


async def consume_state(state: str | None) -> str:
    """Validate the state token, return the user_id it was created for, and delete it."""
    return await state_store.consume_state(PROVIDER, state)


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
