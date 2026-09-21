"""Spotify OAuth authorization_code flow (confidential client, client secret).

The backend is a confidential client, so the code is exchanged server-side
with HTTP Basic client credentials. The CSRF `state` is stored in Redis (10
minute TTL, single use) bound to the requesting user_id.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings
from app.integrations import state as state_store
from app.integrations.state import OAuthStateError

AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
# Only what the mood signal needs. Audio Features / Recommendations are not
# available to apps created after Nov 2024, so they are deliberately unused.
DEFAULT_SCOPES = "user-read-recently-played user-read-currently-playing user-top-read"
PROVIDER = "spotify"
REQUEST_TIMEOUT = 15.0


class SpotifyTokenError(RuntimeError):
    """Token endpoint rejected the request (bad code, revoked refresh token...)."""

    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Spotify token endpoint {status_code}: {body[:300]}")
        self.status_code = status_code
        self.body = body


async def create_state(user_id: str) -> str:
    return await state_store.create_state(PROVIDER, user_id)


async def consume_state(state: str | None) -> str:
    return await state_store.consume_state(PROVIDER, state)


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.spotify_client_id and settings.spotify_client_secret)


def build_authorize_url(state: str, scopes: str = DEFAULT_SCOPES) -> str:
    settings = get_settings()
    params = {
        "response_type": "code",
        "client_id": settings.spotify_client_id or "",
        "redirect_uri": settings.spotify_redirect_uri,
        "scope": scopes,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def _client_auth() -> tuple[str, str]:
    settings = get_settings()
    return settings.spotify_client_id or "", settings.spotify_client_secret or ""


async def _token_request(data: dict[str, str]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as http:
        resp = await http.post(
            TOKEN_URL,
            data=data,
            auth=_client_auth(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code >= 400:
        raise SpotifyTokenError(resp.status_code, resp.text)
    payload = resp.json()
    payload["access_token_expires_at"] = datetime.now(UTC) + timedelta(
        seconds=int(payload.get("expires_in", 3600))
    )
    return payload


async def exchange_code(code: str) -> dict[str, Any]:
    """Trade the authorization code for access + refresh tokens."""
    return await _token_request(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": get_settings().spotify_redirect_uri,
        }
    )


async def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    """Refresh the access token. Spotify MAY rotate the refresh token: when the
    response carries a `refresh_token`, the caller must persist it."""
    return await _token_request({"grant_type": "refresh_token", "refresh_token": refresh_token})


__all__ = [
    "DEFAULT_SCOPES",
    "OAuthStateError",
    "SpotifyTokenError",
    "build_authorize_url",
    "consume_state",
    "create_state",
    "exchange_code",
    "is_configured",
    "refresh_access_token",
]
