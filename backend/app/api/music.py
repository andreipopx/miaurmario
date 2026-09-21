"""Música tab API: listening history, daily mood, tops, looks-by-music, search."""

import logging
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.integrations.spotify.client import SpotifyAPIError
from app.integrations.spotify.oauth import is_configured
from app.models.user import User
from app.services import music_overview as mo
from app.services import spotify_mood
from app.services.listening_history import maybe_sync
from app.services.listening_mood import local_day_bounds, user_zone
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/music", tags=["music"])


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
    connection = await spotify_mood.get_connection(db, current_user.id)

    rows = await mo.mood_timeline(db, current_user.id, zone, start, today)
    recent = await mo.recent_events(db, current_user.id, limit=50)

    now = await mo.now_playing(db, connection) if connection is not None else None
    tops = await mo.spotify_tops(db, connection, range) if connection is not None else None
    top_source = "spotify"
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

    return {
        "configured": is_configured(),
        "connected": connection is not None,
        "range": range,
        "start": start.isoformat(),
        "end": today.isoformat(),
        "last_synced_at": connection.last_history_sync_at.isoformat()
        if connection is not None and connection.last_history_sync_at
        else None,
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
    """On-demand sync (Música tab open). Throttled to one real sync per 2 minutes."""
    await rate_limit_by_user(current_user.id, "music_sync", max_requests=6, window_seconds=60)
    connection = await spotify_mood.get_connection(db, current_user.id)
    if connection is None:
        return {"connected": False, "skipped": True, "inserted": 0, "last_synced_at": None}
    previous_sync = connection.last_history_sync_at
    try:
        result = await maybe_sync(db, connection, current_user)
    except SpotifyAPIError as exc:
        await db.rollback()
        logger.info("On-demand history sync failed for %s: %s", current_user.id, exc)
        code = "rate_limited" if exc.status_code == 429 else "spotify_error"
        return {
            "connected": True,
            "skipped": True,
            "inserted": 0,
            "error": code,
            "last_synced_at": previous_sync.isoformat() if previous_sync else None,
        }
    if not result.skipped:
        await mo.clear_user_cache(current_user.id)
    return {
        "connected": True,
        "skipped": result.skipped,
        "inserted": result.inserted,
        "days": [d.isoformat() for d in result.days],
        "last_synced_at": result.last_synced_at.isoformat() if result.last_synced_at else None,
    }


@router.get("/now-playing")
async def now_playing(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    connection = await spotify_mood.get_connection(db, current_user.id)
    if connection is None:
        return {"connected": False, "track": None}
    return {"connected": True, "track": await mo.now_playing(db, connection)}


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
    connection = await spotify_mood.get_connection(db, current_user.id)
    if connection is not None:
        items = await mo.search_spotify(db, connection, query)
        if items is not None:
            return {"source": "spotify", "items": items}
    items = await mo.search_fallback(query)
    source = items[0]["source"] if items else None
    return {"source": source, "items": items}
