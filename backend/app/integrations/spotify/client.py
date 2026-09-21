"""Thin async client for the Spotify Web API — only the endpoints we use.

- Keeps the persisted SpotifyConnection's access token fresh (tokens last 1h;
  refresh when under 2 minutes remain, persisting a rotated refresh token).
- On a 401 it forces one refresh and retries once.
- Respects 429 Retry-After (single retry, capped).

Endpoints used are all still available to Development Mode apps after the
Nov 2024 and Feb 2026 Web API changes: /me, /me/player/currently-playing,
/me/player/recently-played, /me/top/artists, /me/top/tracks, /artists/{id}
(single fetch; the batch /artists endpoint was removed), /tracks/{id} and
/search. All of them are covered by the scopes the connect flow already asks
for (user-read-recently-played, user-read-currently-playing, user-top-read).
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.crypto import decrypt_token, encrypt_token
from app.integrations.spotify.oauth import SpotifyTokenError, refresh_access_token
from app.models.spotify import SpotifyConnection

logger = logging.getLogger(__name__)

API_BASE = "https://api.spotify.com/v1"
REFRESH_WINDOW_SECONDS = 120
MAX_RETRY_AFTER_SECONDS = 10


class SpotifyAPIError(RuntimeError):
    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Spotify API {status_code}: {body[:300]}")
        self.status_code = status_code
        self.body = body


class SpotifyClient:
    def __init__(
        self,
        connection: SpotifyConnection,
        db: AsyncSession | None,
        timeout: float = 10.0,
    ) -> None:
        self._connection = connection
        self._db = db
        self._timeout = timeout

    async def refresh(self) -> str:
        """Refresh the access token and persist it (and any rotated refresh token)."""
        refresh_token = decrypt_token(self._connection.refresh_token_ct)
        try:
            payload = await refresh_access_token(refresh_token)
        except SpotifyTokenError as exc:
            raise SpotifyAPIError(exc.status_code, exc.body) from exc
        now = datetime.now(UTC)
        self._connection.access_token_ct = encrypt_token(payload["access_token"])
        self._connection.access_token_expires_at = payload["access_token_expires_at"]
        if payload.get("refresh_token"):
            self._connection.refresh_token_ct = encrypt_token(payload["refresh_token"])
        if payload.get("scope"):
            self._connection.scopes = str(payload["scope"])[:255]
        self._connection.last_refreshed_at = now
        if self._db is not None:
            await self._db.commit()
        return payload["access_token"]

    async def _access_token(self) -> str:
        expires_at = self._connection.access_token_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at - datetime.now(UTC) > timedelta(seconds=REFRESH_WINDOW_SECONDS):
            return decrypt_token(self._connection.access_token_ct)
        return await self.refresh()

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """GET a Web API path. Returns None on 204 No Content."""
        token = await self._access_token()
        async with httpx.AsyncClient(timeout=self._timeout) as http:

            async def _do(tok: str) -> httpx.Response:
                return await http.get(
                    f"{API_BASE}{path}",
                    params=params,
                    headers={"Authorization": f"Bearer {tok}"},
                )

            resp = await _do(token)
            if resp.status_code == 401:
                token = await self.refresh()
                resp = await _do(token)
            if resp.status_code == 429:
                try:
                    retry_after = int(resp.headers.get("Retry-After", "1") or "1")
                except ValueError:
                    retry_after = 1
                retry_after = min(max(retry_after, 0), MAX_RETRY_AFTER_SECONDS)
                logger.warning("Spotify 429 on %s; sleeping %ss", path, retry_after)
                await asyncio.sleep(retry_after)
                resp = await _do(token)
        if resp.status_code == 204 or (resp.status_code == 200 and not resp.content):
            return None
        if resp.status_code >= 400:
            raise SpotifyAPIError(resp.status_code, resp.text)
        return resp.json()

    async def get_me(self) -> dict[str, Any]:
        return await self._get("/me") or {}

    async def get_currently_playing(self) -> dict[str, Any] | None:
        return await self._get("/me/player/currently-playing")

    async def get_recently_played(
        self, limit: int = 10, after: int | None = None, before: int | None = None
    ) -> dict[str, Any]:
        """Recently played tracks (max 50 per call; Spotify only keeps ~the last 50).

        `after` / `before` are Unix epoch milliseconds cursors (mutually exclusive).
        """
        params: dict[str, Any] = {"limit": max(1, min(limit, 50))}
        if after is not None:
            params["after"] = int(after)
        elif before is not None:
            params["before"] = int(before)
        return await self._get("/me/player/recently-played", params) or {}

    async def get_top_artists(
        self, time_range: str = "short_term", limit: int = 10
    ) -> dict[str, Any]:
        return await self._get("/me/top/artists", {"time_range": time_range, "limit": limit}) or {}

    async def get_top_tracks(
        self, time_range: str = "short_term", limit: int = 10
    ) -> dict[str, Any]:
        return await self._get("/me/top/tracks", {"time_range": time_range, "limit": limit}) or {}

    async def get_artist(self, artist_id: str) -> dict[str, Any]:
        return await self._get(f"/artists/{artist_id}") or {}

    async def get_track(self, track_id: str) -> dict[str, Any]:
        return await self._get(f"/tracks/{track_id}") or {}

    async def search_track(self, query: str) -> dict[str, Any] | None:
        data = await self._get("/search", {"q": query, "type": "track", "limit": 1}) or {}
        items = (data.get("tracks") or {}).get("items") or []
        return items[0] if items else None

    async def search_tracks(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        data = (
            await self._get(
                "/search", {"q": query, "type": "track", "limit": max(1, min(limit, 10))}
            )
            or {}
        )
        items = (data.get("tracks") or {}).get("items") or []
        return [i for i in items if isinstance(i, dict)]
