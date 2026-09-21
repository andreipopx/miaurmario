"""Derive a Stylist mood signal from a user's Spotify listening.

Spotify apps created after Nov 2024 cannot use Audio Features / Audio Analysis
/ Recommendations, so there is no valence/energy to read. Instead the signal is
built from:
  1. the track playing right now (or, if nothing is playing, the most recent
     track played),
  2. the genres of that track's main artist (single GET /artists/{id}; the batch
     endpoint was removed in Feb 2026),
  3. the genres + names of the user's short-term top artists,
  4. Last.fm mood tags for the track when LASTFM_API_KEY is set.

Every function here is best-effort: on any error it logs and returns None so
the suggestion endpoint never fails because of Spotify.
"""

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.spotify.client import SpotifyClient
from app.models.spotify import SpotifyConnection
from app.services.music_service import (
    SongContext,
    _cache_get,
    _cache_set,
    _extract_year,
    _parse_spotify_url,
    lastfm_tags,
)

logger = logging.getLogger(__name__)

MOOD_CACHE_TTL_SECONDS = 300
MOOD_CACHE_PREFIX = "music:spotify:mood"
QUERY_CACHE_PREFIX = "music:spotify:query"
MAX_GENRES = 6
SPOTIFY_TIMEOUT = 5.0


async def get_connection(db: AsyncSession, user_id: uuid.UUID | str) -> SpotifyConnection | None:
    return (
        await db.execute(select(SpotifyConnection).where(SpotifyConnection.user_id == user_id))
    ).scalar_one_or_none()


def mood_cache_key(user_id: uuid.UUID | str) -> str:
    return f"{MOOD_CACHE_PREFIX}:{user_id}"


async def clear_mood_cache(user_id: uuid.UUID | str) -> None:
    try:
        from app.utils.redis_lock import get_redis

        redis = await get_redis()
        await redis.delete(mood_cache_key(user_id))
    except Exception:
        logger.debug("Could not clear Spotify mood cache", exc_info=True)


def _dedupe(values: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        if not v or not isinstance(v, str):
            continue
        key = v.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(v.strip())
        if len(out) >= limit:
            break
    return out


def _track_parts(track: dict[str, Any]) -> dict[str, Any]:
    artists = [a for a in (track.get("artists") or []) if isinstance(a, dict)]
    album = track.get("album") if isinstance(track.get("album"), dict) else {}
    return {
        "artist": artists[0].get("name") if artists else None,
        "artist_id": artists[0].get("id") if artists else None,
        "track": track.get("name"),
        "album": album.get("name") if album else None,
        "year": _extract_year(album.get("release_date")) if album else None,
    }


async def _artist_genres(client: SpotifyClient, artist_id: str | None) -> list[str]:
    if not artist_id:
        return []
    try:
        artist = await client.get_artist(artist_id)
    except Exception as exc:
        logger.debug("Spotify artist lookup failed: %s", exc)
        return []
    genres = artist.get("genres") or []
    return [g for g in genres if isinstance(g, str)]


async def listening_mood(db: AsyncSession, connection: SpotifyConnection) -> SongContext | None:
    """Mood context from current / recent listening + top-artist genres."""
    cache_key = mood_cache_key(connection.user_id)
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    client = SpotifyClient(connection, db, timeout=SPOTIFY_TIMEOUT)
    track: dict[str, Any] | None = None
    listening: str | None = None
    try:
        current = await client.get_currently_playing()
        if (
            current
            and current.get("currently_playing_type", "track") == "track"
            and isinstance(current.get("item"), dict)
        ):
            track = current["item"]
            listening = "now_playing"
        if track is None:
            recent = await client.get_recently_played(limit=1)
            items = recent.get("items") or []
            if items and isinstance(items[0].get("track"), dict):
                track = items[0]["track"]
                listening = "recently_played"
    except Exception as exc:
        logger.warning("Spotify listening lookup failed for user %s: %s", connection.user_id, exc)
        return None

    top_names: list[str] = []
    top_genres: list[str] = []
    try:
        top = await client.get_top_artists(time_range="short_term", limit=5)
        for artist in top.get("items") or []:
            if not isinstance(artist, dict):
                continue
            if artist.get("name"):
                top_names.append(artist["name"])
            top_genres.extend(g for g in artist.get("genres") or [] if isinstance(g, str))
    except Exception as exc:
        logger.debug("Spotify top artists lookup failed: %s", exc)

    parts = _track_parts(track) if track else {}
    track_genres = await _artist_genres(client, parts.get("artist_id")) if track else []

    if not track and not top_names and not top_genres:
        return None

    tags = await lastfm_tags(parts.get("artist"), parts.get("track"))
    label = (
        f"{parts['artist']} — {parts['track']}"
        if parts.get("artist") and parts.get("track")
        else "Spotify"
    )
    ctx = SongContext(
        query=label,
        artist=parts.get("artist"),
        track=parts.get("track"),
        album=parts.get("album"),
        year=parts.get("year"),
        genres=_dedupe(track_genres + top_genres, MAX_GENRES),
        tags=tags,
        source="spotify",
        listening=listening or "top_artists",
        top_artists=_dedupe(top_names, 5),
    )
    await _cache_set_ttl(cache_key, ctx, MOOD_CACHE_TTL_SECONDS)
    return ctx


async def resolve_query(
    db: AsyncSession, connection: SpotifyConnection, query: str
) -> SongContext | None:
    """Resolve an explicit song query (Spotify URL or free text) via the Web API."""
    query = query.strip()[:300]
    if not query:
        return None
    cache_key = f"{QUERY_CACHE_PREFIX}:{query.lower()}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    client = SpotifyClient(connection, db, timeout=SPOTIFY_TIMEOUT)
    try:
        track_id = _parse_spotify_url(query)
        track = await client.get_track(track_id) if track_id else await client.search_track(query)
    except Exception as exc:
        logger.info("Spotify query resolution failed (%s); falling back to Last.fm", exc)
        return None
    if not track or not track.get("name"):
        return None

    parts = _track_parts(track)
    genres = await _artist_genres(client, parts.get("artist_id"))
    tags = await lastfm_tags(parts.get("artist"), parts.get("track"))
    ctx = SongContext(
        query=query,
        artist=parts.get("artist"),
        track=parts.get("track"),
        album=parts.get("album"),
        year=parts.get("year"),
        genres=_dedupe(genres, MAX_GENRES),
        tags=tags,
        source="spotify",
    )
    await _cache_set(cache_key, ctx)
    return ctx


async def _cache_set_ttl(key: str, ctx: SongContext, ttl: int) -> None:
    try:
        from app.utils.redis_lock import get_redis

        redis = await get_redis()
        await redis.set(key, ctx.model_dump_json(), ex=ttl)
    except Exception:
        logger.debug("Spotify mood cache write failed", exc_info=True)
