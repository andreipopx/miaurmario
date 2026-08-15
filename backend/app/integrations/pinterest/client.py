"""Thin async client for Pinterest API v5.

Responsibilities:
- Keep the persisted PinterestConnection's access_token fresh (refresh if it
  expires in under 5 minutes).
- Respect 429 Retry-After (single retry, capped at 30s).
- Paginate boards and pins via the API's bookmark cursor.

Deliberately NOT a generic wrapper — only the endpoints the app actually uses.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations.pinterest.crypto import decrypt_token, encrypt_token
from app.models.pinterest import PinterestConnection

logger = logging.getLogger(__name__)

API_BASE = "https://api.pinterest.com/v5"
TOKEN_URL = f"{API_BASE}/oauth/token"
REFRESH_WINDOW_SECONDS = 300
MAX_RETRY_AFTER_SECONDS = 30


class PinterestAPIError(RuntimeError):
    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Pinterest API {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class PinterestClient:
    def __init__(self, connection: PinterestConnection, db: AsyncSession) -> None:
        self._connection = connection
        self._db = db

    async def _ensure_fresh(self) -> str:
        """Return a valid access token, refreshing if it expires soon."""
        expires_at = self._connection.access_token_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at - datetime.now(UTC) > timedelta(seconds=REFRESH_WINDOW_SECONDS):
            return decrypt_token(self._connection.access_token_ct)

        settings = get_settings()
        refresh_token = decrypt_token(self._connection.refresh_token_ct)
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                TOKEN_URL,
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                auth=(
                    settings.pinterest_client_id or "",
                    settings.pinterest_client_secret or "",
                ),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code >= 400:
            raise PinterestAPIError(resp.status_code, resp.text)
        payload = resp.json()
        now = datetime.now(UTC)
        self._connection.access_token_ct = encrypt_token(payload["access_token"])
        self._connection.access_token_expires_at = now + timedelta(
            seconds=payload.get("expires_in", 3600)
        )
        if "refresh_token" in payload:
            self._connection.refresh_token_ct = encrypt_token(payload["refresh_token"])
        # Continuous refresh: each use rolls the outer window forward.
        self._connection.refresh_token_expires_at = now + timedelta(days=60)
        self._connection.last_refreshed_at = now
        await self._db.commit()
        return payload["access_token"]

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        token = await self._ensure_fresh()
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(f"{API_BASE}{path}", params=params, headers=headers)
            if resp.status_code == 429:
                retry_after = min(
                    int(resp.headers.get("Retry-After", "5") or "5"),
                    MAX_RETRY_AFTER_SECONDS,
                )
                logger.warning("Pinterest 429 on %s; sleeping %ss", path, retry_after)
                await asyncio.sleep(retry_after)
                resp = await http.get(f"{API_BASE}{path}", params=params, headers=headers)
        if resp.status_code >= 400:
            raise PinterestAPIError(resp.status_code, resp.text)
        return resp.json()

    async def get_user_account(self) -> dict[str, Any]:
        return await self._get("/user_account")

    async def list_boards(
        self, bookmark: str | None = None, page_size: int = 100
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page_size": page_size}
        if bookmark:
            params["bookmark"] = bookmark
        return await self._get("/boards", params=params)

    async def list_board_pins(
        self, board_id: str, bookmark: str | None = None, page_size: int = 100
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page_size": page_size}
        if bookmark:
            params["bookmark"] = bookmark
        return await self._get(f"/boards/{board_id}/pins", params=params)
