"""Música tab API: listening history, daily mood, tops, looks-by-music, search.

Source-agnostic: history comes from Spotify and/or Last.fm (see
``app.services.music_source``); the response says which one is in use.
"""

import logging
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.integrations.lastfm.client import LastfmError
from app.integrations.lastfm.client import is_configured as lastfm_configured
from app.integrations.spotify.client import SpotifyAPIError
from app.integrations.spotify.oauth import is_configured
from app.models.user import User
from app.services import lastfm_history, music_source
from app.services import music_overview as mo
from app.services.listening_history import maybe_sync
from app.services.listening_mood import local_day_bounds, user_zone
from app.services.preference_service import PreferenceService
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/music", tags=["music"])


def _sources_payload(sources: music_source.MusicSources) -> dict[str, Any]:
    return {
        "source": sources.primary,
        "sources": {
            "spotify": sources.spotify is not None,
            "lastfm": sources.lastfm is not None,
        },
    }


@router.get("/overview")
async def overview(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    range: Annotated[Literal["7d", "30d", "6m"], Query()] = "7d",  # noqa: A002
) -> dict[str, Any]:
    zone = user_zone(current_user.timezone)
    today = datetime.now(zone).date()
    start = today - timedelta(days=mo.RANGE_DAYS[range] - 1)
    since, _ = local_day_bounds(start, zone)
    sources = await music_source.get_sources(db, current_user.id)

    rows = await mo.mood_timeline(db, current_user.id, zone, start, today)
    recent = await mo.recent_events(db, current_user.id, limit=50)

    now = await music_source.now_playing(db, sources) if sources.connected else None
    tops = None
    top_source = "history"
    if sources.spotify is not None:
        tops = await mo.spotify_tops(db, sources.spotify, range)
        top_source = "spotify"
    elif sources.lastfm is not None:
        tops = await lastfm_history.tops(sources.lastfm, range)
        top_source = "lastfm"
    if not tops or not (tops.get("artists") or tops.get("tracks")):
        tops = await mo.history_tops(db, current_user.id, since)
        top_source = "history"

    moods_by_day = {r.day: r for r in rows}
    looks = await mo.outfits_by_day(db, current_user.id, zone, start, today)
    look_days = sorted(looks, reverse=True)
    day_tracks = await mo.top_tracks_per_day(db, current_user.id, zone, look_days)
    outfit_days = []
    for day in look_days:
        mood = moods_by_day.get(day)
        outfit_days.append(
            {
                "date": day.isoformat(),
                "mood": mo.mood_payload(mood) if mood else None,
                "outfits": looks[day],
                "tracks": day_tracks.get(day, []),
            }
        )

    last_synced = sources.last_synced_at
    return {
        "configured": is_configured(),
        "lastfm_configured": lastfm_configured(),
        "connected": sources.connected,
        **_sources_payload(sources),
        "lastfm_username": sources.lastfm.username if sources.lastfm else None,
        "range": range,
        "start": start.isoformat(),
        "end": today.isoformat(),
        "last_synced_at": last_synced.isoformat() if last_synced else None,
        "now_playing": now,
        "recent": [mo.event_payload(e) for e in recent],
        "top_artists": tops.get("artists", []),
        "top_tracks": tops.get("tracks", []),
        "top_source": top_source,
        "moods": [mo.mood_payload(r) for r in rows],
        "genres": mo.genre_breakdown(rows),
        "stats": await mo.stats(db, current_user.id, since, rows),
        "outfit_days": outfit_days,
    }


@router.get("/recent")
async def recent(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Annotated[datetime | None, Query()] = None,
) -> dict[str, Any]:
    events = await mo.recent_events(db, current_user.id, limit=limit, before=before)
    return {
        "items": [mo.event_payload(e) for e in events],
        "next_before": events[-1].played_at.isoformat() if len(events) == limit else None,
    }


@router.post("/sync")
async def sync(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """On-demand sync (Música tab open) of every connected source.

    Each source is throttled to one real sync per 2 minutes.
    """
    await rate_limit_by_user(current_user.id, "music_sync", max_requests=6, window_seconds=60)
    sources = await music_source.get_sources(db, current_user.id)
    if not sources.connected:
        return {"connected": False, "skipped": True, "inserted": 0, "last_synced_at": None}

    inserted = 0
    skipped = True
    errors: dict[str, str] = {}
    days: set[str] = set()
    if sources.spotify is not None:
        try:
            result = await maybe_sync(db, sources.spotify, current_user)
            inserted += result.inserted
            skipped = skipped and result.skipped
            days.update(d.isoformat() for d in result.days)
        except SpotifyAPIError as exc:
            await db.rollback()
            logger.info("On-demand Spotify sync failed for %s: %s", current_user.id, exc)
            errors["spotify"] = "rate_limited" if exc.status_code == 429 else "spotify_error"
    if sources.lastfm is not None:
        connection = sources.lastfm
        try:
            result = await lastfm_history.maybe_sync(db, connection, current_user)
            inserted += result.inserted
            skipped = skipped and result.skipped
            days.update(d.isoformat() for d in result.days)
        except LastfmError as exc:
            await db.rollback()
            logger.info("On-demand Last.fm sync failed for %s: %s", current_user.id, exc)
            errors["lastfm"] = exc.reason
            connection = await music_source.get_lastfm_connection(db, current_user.id)
            if connection is not None and not exc.rate_limited:
                connection.last_error = exc.reason
                await db.commit()
    if inserted:
        await music_source.clear_caches(current_user.id)
    sources = await music_source.get_sources(db, current_user.id)
    last = sources.last_synced_at
    payload: dict[str, Any] = {
        "connected": True,
        "skipped": skipped,
        "inserted": inserted,
        "days": sorted(days),
        "last_synced_at": last.isoformat() if last else None,
    }
    if errors:
        # Backwards compatible single code (Spotify first) + per-source detail.
        payload["error"] = next(iter(errors.values()))
        payload["errors"] = errors
    return payload


@router.get("/now-playing")
async def now_playing(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    sources = await music_source.get_sources(db, current_user.id)
    if not sources.connected:
        return {"connected": False, "source": None, "track": None}
    track = await music_source.now_playing(db, sources)
    return {
        "connected": True,
        "source": track.get("source") if track else sources.primary,
        "track": track,
    }


class MusicSettingsUpdate(BaseModel):
    contrast: bool


async def _settings_payload(db: AsyncSession, user: User) -> dict[str, Any]:
    sources = await music_source.get_sources(db, user.id)
    return {
        "contrast": await music_source.contrast_enabled(db, user.id),
        "use_for_mood": sources.use_for_mood,
        **_sources_payload(sources),
    }


@router.get("/settings")
async def get_settings_(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Music preferences + which source is connected (for the Estilista / settings)."""
    return await _settings_payload(db, current_user)


@router.patch("/settings")
async def update_settings(
    body: MusicSettingsUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """ "Deja que Stinky contraste tu música" (off by default)."""
    prefs = await PreferenceService(db).get_or_create_preferences(current_user.id)
    prefs.music_contrast = body.contrast
    await db.commit()
    return await _settings_payload(db, current_user)


@router.delete("/history")
async def delete_history(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """ "Borrar mi historial de escuchas": every play + every daily mood of the user.

    Connections stay; their sync cursors are kept so the deleted plays are
    not imported again.
    """
    await rate_limit_by_user(current_user.id, "music_delete", max_requests=5, window_seconds=60)
    deleted = await music_source.delete_history(db, current_user.id)
    logger.info("User %s deleted their listening history", current_user.id)
    return {"deleted": deleted}


@router.get("/search")
async def search(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
) -> dict[str, Any]:
    """Song autocomplete for the Estilista (Spotify, else Last.fm / MusicBrainz)."""
    query = mo.normalise_query(q)
    if len(query) < 2:
        return {"source": None, "items": []}
    await rate_limit_by_user(current_user.id, "music_search", max_requests=40, window_seconds=60)
    sources = await music_source.get_sources(db, current_user.id)
    if sources.spotify is not None:
        items = await mo.search_spotify(db, sources.spotify, query)
        if items is not None:
            return {"source": "spotify", "items": items}
    items = await mo.search_fallback(query)
    source = items[0]["source"] if items else None
    return {"source": source, "items": items}
