"""Last.fm integration API: connect by username (or optional web auth), status,
settings, disconnect.

Last.fm is the music source for everyone without Spotify: the user links
Spotify to Last.fm (last.fm/settings/applications → Spotify scrobbling) and
enters their Last.fm username here. Scrobbles are public by default; a profile
that hides its recent listening answers error 17 and is reported as
``lastfm_private`` so the UI can explain how to fix it.
"""

import logging
import uuid
from typing import Annotated, Any
from urllib.parse import quote

from arq import create_pool
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.integrations.crypto import encrypt_token, encryption_configured
from app.integrations.lastfm.client import (
    LastfmClient,
    LastfmError,
    auth_configured,
    auth_url,
    is_configured,
)
from app.integrations.redirects import frontend_redirect
from app.integrations.state import OAuthStateError, consume_state, create_state
from app.models.lastfm import LastfmConnection
from app.models.user import User
from app.services import lastfm_history, music_source
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/lastfm", tags=["integrations"])

SETTINGS_PATH = "/dashboard/settings/integrations/lastfm"
PROVIDER = "lastfm"
USERNAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.\-]{1,63}$"


class LastfmConnectRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=USERNAME_PATTERN)


class LastfmSettingsUpdate(BaseModel):
    use_for_mood: bool


def profile_url(username: str) -> str:
    return f"https://www.last.fm/user/{quote(username, safe='')}"


def _status_payload(connection: LastfmConnection | None) -> dict[str, Any]:
    return {
        "configured": is_configured(),
        "auth_available": auth_configured() and encryption_configured(),
        "connected": connection is not None,
        "username": connection.username if connection else None,
        "profile_url": profile_url(connection.username) if connection else None,
        "authenticated": bool(connection and connection.session_key_ct),
        "connected_at": connection.connected_at.isoformat()
        if connection and connection.connected_at
        else None,
        "last_sync_at": connection.last_sync_at.isoformat()
        if connection and connection.last_sync_at
        else None,
        "last_error": connection.last_error if connection else None,
        "use_for_mood": connection.use_for_mood if connection else False,
    }


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, detail={"code": code, "message": message})


async def enqueue_first_sync(user_id: uuid.UUID) -> None:
    """Import the last weeks right away instead of waiting for the cron."""
    try:
        redis = await create_pool(get_redis_settings())
        try:
            await redis.enqueue_job(
                "sync_lastfm_user_job",
                str(user_id),
                _queue_name="arq:tagging",
                _job_id=f"lastfm-sync-{user_id}",
            )
        finally:
            await redis.aclose()
    except Exception:
        logger.warning("Could not enqueue the first Last.fm sync for %s", user_id, exc_info=True)


async def _save_connection(
    db: AsyncSession, user_id: uuid.UUID, username: str, session_key_ct: bytes | None
) -> LastfmConnection:
    connection = await music_source.get_lastfm_connection(db, user_id)
    if connection is None:
        connection = LastfmConnection(user_id=user_id, username=username, use_for_mood=True)
        db.add(connection)
    elif connection.username.casefold() != username.casefold():
        # A different account: start its history from scratch.
        connection.cursor_uts = None
        connection.last_sync_at = None
    connection.username = username
    connection.session_key_ct = session_key_ct
    connection.last_error = None
    await db.commit()
    await db.refresh(connection)
    await lastfm_history.clear_cache(user_id)
    return connection


@router.get("/status")
async def get_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    return _status_payload(await music_source.get_lastfm_connection(db, current_user.id))


@router.post("/connect")
async def connect(
    body: LastfmConnectRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Link a Last.fm username after checking it exists and its scrobbles are readable."""
    if not is_configured():
        raise _error(503, "lastfm_not_configured", "Last.fm is not configured")
    await rate_limit_by_user(current_user.id, "lastfm_connect", max_requests=10, window_seconds=60)
    client = LastfmClient(timeout=6.0)
    try:
        info = await client.user_info(body.username)
        # Recent tracks are what we sync: a profile hiding them answers error 17.
        await client.recent_tracks(body.username, limit=1, extended=False)
    except LastfmError as exc:
        if exc.not_found:
            raise _error(404, "lastfm_user_not_found", "Last.fm user not found") from exc
        if exc.private:
            raise _error(
                422, "lastfm_private", "This Last.fm profile hides its recent listening"
            ) from exc
        if exc.rate_limited:
            raise _error(503, "lastfm_rate_limited", "Last.fm is busy, try again") from exc
        logger.warning("Last.fm connect failed for %s: %s", current_user.id, exc)
        raise _error(502, "lastfm_unavailable", "Last.fm could not be reached") from exc
    username = str(info.get("name") or body.username)[:64]
    connection = await _save_connection(db, current_user.id, username, None)
    await enqueue_first_sync(current_user.id)
    return _status_payload(connection)


@router.get("/auth-url")
async def get_auth_url(
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    """Optional web auth (needs LASTFM_API_SECRET): "Iniciar sesión con Last.fm"."""
    if not (auth_configured() and encryption_configured()):
        raise _error(503, "lastfm_auth_not_configured", "Last.fm web auth is not configured")
    state = await create_state(PROVIDER, str(current_user.id))
    callback = f"{get_settings().lastfm_callback_url}?state={state}"
    return {"authorize_url": auth_url(callback)}


@router.get("/callback")
async def callback(
    db: Annotated[AsyncSession, Depends(get_db)],
    state: Annotated[str | None, Query()] = None,
    token: Annotated[str | None, Query(max_length=128)] = None,
) -> RedirectResponse:
    try:
        user_id = uuid.UUID(await consume_state(PROVIDER, state))
    except (OAuthStateError, ValueError) as exc:
        logger.warning("Last.fm auth state rejected: %s", exc)
        return frontend_redirect(SETTINGS_PATH, error="invalid_state")
    if not token:
        return frontend_redirect(SETTINGS_PATH, error="access_denied")
    try:
        session = await LastfmClient(timeout=6.0).get_session(token)
    except LastfmError as exc:
        logger.warning("Last.fm auth.getSession failed: %s", exc)
        return frontend_redirect(SETTINGS_PATH, error="session_failed")
    name, key = session.get("name"), session.get("key")
    if not name or not key:
        return frontend_redirect(SETTINGS_PATH, error="session_failed")
    await _save_connection(db, user_id, str(name)[:64], encrypt_token(str(key)))
    await enqueue_first_sync(user_id)
    return frontend_redirect(SETTINGS_PATH, connected="1")


@router.patch("/settings")
async def update_settings(
    body: LastfmSettingsUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    connection = await music_source.get_lastfm_connection(db, current_user.id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Last.fm not connected")
    connection.use_for_mood = body.use_for_mood
    await db.commit()
    await lastfm_history.clear_cache(current_user.id)
    return _status_payload(connection)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    keep_history: Annotated[bool, Query()] = True,
) -> None:
    """Disconnect; `keep_history=false` also deletes the plays imported from Last.fm."""
    await db.execute(delete(LastfmConnection).where(LastfmConnection.user_id == current_user.id))
    await db.commit()
    if not keep_history:
        await music_source.delete_history(
            db, current_user.id, source="lastfm", tz_name=current_user.timezone
        )
    await music_source.clear_caches(current_user.id)
