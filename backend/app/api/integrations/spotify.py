"""Spotify integration API — OAuth connect/callback, status, mood preview, disconnect."""

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.integrations.crypto import encrypt_token, encryption_configured
from app.integrations.redirects import frontend_redirect
from app.integrations.spotify import (
    DEFAULT_SCOPES,
    OAuthStateError,
    SpotifyAPIError,
    SpotifyClient,
    SpotifyTokenError,
    build_authorize_url,
    consume_state,
    create_state,
    exchange_code,
    is_configured,
)
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.services import spotify_mood
from app.services.music_overview import clear_user_cache as clear_music_cache
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/spotify", tags=["integrations"])

SETTINGS_PATH = "/dashboard/settings/integrations/spotify"


class SpotifySettingsUpdate(BaseModel):
    use_for_mood: bool


def _configured() -> bool:
    return is_configured() and encryption_configured()


def _status_payload(connection: SpotifyConnection | None) -> dict[str, Any]:
    return {
        "configured": _configured(),
        "lastfm_configured": bool(get_settings().lastfm_api_key),
        "connected": connection is not None,
        "spotify_user_id": connection.spotify_user_id if connection else None,
        "display_name": connection.display_name if connection else None,
        "connected_at": connection.connected_at.isoformat()
        if connection and connection.connected_at
        else None,
        "scopes": connection.scopes if connection else None,
        "use_for_mood": connection.use_for_mood if connection else False,
    }


@router.get("/status")
async def get_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    return _status_payload(await spotify_mood.get_connection(db, current_user.id))


@router.get("/connect")
async def connect(
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    if not _configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Spotify not configured")
    state = await create_state(str(current_user.id))
    return {"authorize_url": build_authorize_url(state)}


@router.get("/callback")
async def callback(
    db: Annotated[AsyncSession, Depends(get_db)],
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    try:
        user_id = uuid.UUID(await consume_state(state))
    except (OAuthStateError, ValueError) as exc:
        logger.warning("Spotify OAuth state rejected: %s", exc)
        return frontend_redirect(SETTINGS_PATH, error="invalid_state")
    if error or not code:
        logger.info("Spotify OAuth denied/aborted: %s", error)
        return frontend_redirect(SETTINGS_PATH, error="access_denied")

    try:
        tokens = await exchange_code(code)
    except SpotifyTokenError as exc:
        logger.warning("Spotify token exchange failed: %s", exc)
        return frontend_redirect(SETTINGS_PATH, error="exchange_failed")
    refresh_token = tokens.get("refresh_token")
    if not tokens.get("access_token") or not refresh_token:
        logger.warning("Spotify token response missing tokens")
        return frontend_redirect(SETTINGS_PATH, error="exchange_failed")

    access_ct = encrypt_token(tokens["access_token"])
    refresh_ct = encrypt_token(refresh_token)
    scopes = str(tokens.get("scope") or DEFAULT_SCOPES)[:255]

    # Probe /me with a transient connection. In Development Mode Spotify answers
    # 403 for accounts that are not on the app's allowlist — surface that clearly.
    probe = SpotifyConnection(
        user_id=user_id,
        spotify_user_id="pending",
        access_token_ct=access_ct,
        refresh_token_ct=refresh_ct,
        access_token_expires_at=tokens["access_token_expires_at"],
        scopes=scopes,
    )
    try:
        me = await SpotifyClient(probe, None).get_me()
    except SpotifyAPIError as exc:
        logger.warning("Spotify /me failed after OAuth: %s", exc)
        reason = "not_allowlisted" if exc.status_code == 403 else "profile_failed"
        return frontend_redirect(SETTINGS_PATH, error=reason)

    connection = await spotify_mood.get_connection(db, user_id)
    if connection is None:
        connection = SpotifyConnection(user_id=user_id, use_for_mood=True)
        db.add(connection)
    connection.spotify_user_id = str(me.get("id") or "unknown")[:128]
    display_name = me.get("display_name")
    connection.display_name = str(display_name)[:255] if display_name else None
    connection.access_token_ct = probe.access_token_ct
    connection.refresh_token_ct = probe.refresh_token_ct
    connection.access_token_expires_at = probe.access_token_expires_at
    connection.scopes = probe.scopes
    await db.commit()
    await spotify_mood.clear_mood_cache(user_id)
    return frontend_redirect(SETTINGS_PATH, connected="1")


@router.patch("/settings")
async def update_settings(
    body: SpotifySettingsUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    connection = await spotify_mood.get_connection(db, current_user.id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spotify not connected")
    connection.use_for_mood = body.use_for_mood
    await db.commit()
    await spotify_mood.clear_mood_cache(current_user.id)
    return _status_payload(connection)


@router.get("/mood")
async def get_mood(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh: bool = False,
) -> dict[str, Any]:
    """What the Stylist would use as mood input right now when no song is typed.

    `refresh=true` bypasses the 5-minute mood cache.
    """
    settings = get_settings()
    fallback = "lastfm" if settings.lastfm_api_key else "musicbrainz"
    connection = await spotify_mood.get_connection(db, current_user.id)
    if connection is None or not connection.use_for_mood:
        return {
            "source": "manual",
            "fallback": fallback,
            "reason": "not_connected" if connection is None else "disabled",
            "context": None,
        }
    if refresh:
        await spotify_mood.clear_mood_cache(current_user.id)
    ctx = await spotify_mood.listening_mood(db, connection)
    if ctx is None:
        return {"source": "manual", "fallback": fallback, "reason": "no_data", "context": None}
    return {
        "source": "spotify",
        "fallback": fallback,
        "reason": None,
        "context": {
            "listening": ctx.listening,
            "artist": ctx.artist,
            "track": ctx.track,
            "label": ctx.display_label,
            "genres": ctx.genres,
            "tags": ctx.tags,
            "top_artists": ctx.top_artists,
        },
    }


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await db.execute(delete(SpotifyConnection).where(SpotifyConnection.user_id == current_user.id))
    await db.commit()
    await spotify_mood.clear_mood_cache(current_user.id)
    await clear_music_cache(current_user.id)
