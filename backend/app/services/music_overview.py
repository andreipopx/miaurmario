"""Read side of the Música tab: now playing, history, tops, mood timeline, looks."""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import Date, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.integrations.spotify.client import SpotifyClient
from app.models.music import ListeningEvent, ListeningMood
from app.models.outfit import Outfit, OutfitItem, OutfitStatus, UserFeedback
from app.models.spotify import SpotifyConnection
from app.services.listening_history import best_image, parse_track
from app.services.listening_mood import (
    local_day_bounds,
    mood_color,
    mood_key,
    one_liner_for,
    recompute_days,
)
from app.utils.signed_urls import sign_image_url

logger = logging.getLogger(__name__)

RangeKey = Literal["7d", "30d", "6m"]
RANGE_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "6m": 182}
# Spotify top endpoints only know ~4 weeks / ~6 months / ~1 year.
SPOTIFY_TIME_RANGE: dict[str, str | None] = {"7d": None, "30d": "short_term", "6m": "medium_term"}

NOW_PLAYING_TTL = 20
TOP_TTL = 60 * 60
SEARCH_TTL_SPOTIFY = 60 * 60
SEARCH_TTL_FALLBACK = 60 * 60 * 24
SEARCH_LIMIT = 8
LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"


# --- small Redis JSON cache ------------------------------------------------------------


async def _cache_get(key: str) -> Any | None:
    try:
        from app.utils.redis_lock import get_redis

        raw = await (await get_redis()).get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def _cache_set(key: str, value: Any, ttl: int) -> None:
    try:
        from app.utils.redis_lock import get_redis

        await (await get_redis()).set(key, json.dumps(value, default=str), ex=ttl)
    except Exception:
        logger.debug("music cache write failed", exc_info=True)


async def clear_user_cache(user_id: Any) -> None:
    try:
        from app.utils.redis_lock import get_redis

        redis = await get_redis()
        keys = [f"music:now:{user_id}"] + [f"music:top:{user_id}:{r}" for r in RANGE_DAYS]
        await redis.delete(*keys)
    except Exception:
        logger.debug("music cache clear failed", exc_info=True)


# --- Spotify live bits ---------------------------------------------------------------------


def _track_payload(track: dict[str, Any]) -> dict[str, Any] | None:
    parsed = parse_track(track)
    if parsed is None:
        return None
    return {
        "track_id": parsed["track_id"],
        "name": parsed["track_name"],
        "artists": parsed["artists"],
        "album": parsed["album"],
        "image_url": parsed["image_url"],
        "duration_ms": parsed["duration_ms"],
        "url": parsed["url"] or f"https://open.spotify.com/track/{parsed['track_id']}",
    }


async def now_playing(db: AsyncSession, connection: SpotifyConnection) -> dict[str, Any] | None:
    """Currently playing track (20 s cache). None when idle / on error."""
    key = f"music:now:{connection.user_id}"
    cached = await _cache_get(key)
    if cached is not None:
        return cached or None
    payload: dict[str, Any] | None = None
    try:
        current = await SpotifyClient(connection, db, timeout=5.0).get_currently_playing()
        if (
            current
            and current.get("currently_playing_type", "track") == "track"
            and isinstance(current.get("item"), dict)
        ):
            payload = _track_payload(current["item"])
            if payload:
                payload["is_playing"] = bool(current.get("is_playing"))
                payload["progress_ms"] = current.get("progress_ms")
    except Exception as exc:
        logger.info("Spotify now-playing failed for %s: %s", connection.user_id, exc)
        return None
    await _cache_set(key, payload or {}, NOW_PLAYING_TTL)
    return payload


async def spotify_tops(
    db: AsyncSession, connection: SpotifyConnection, range_key: str
) -> dict[str, list[dict[str, Any]]] | None:
    time_range = SPOTIFY_TIME_RANGE.get(range_key)
    if time_range is None:
        return None
    key = f"music:top:{connection.user_id}:{range_key}"
    cached = await _cache_get(key)
    if cached:
        return cached
    client = SpotifyClient(connection, db, timeout=8.0)
    try:
        artists_raw = await client.get_top_artists(time_range=time_range, limit=10)
        tracks_raw = await client.get_top_tracks(time_range=time_range, limit=10)
    except Exception as exc:
        logger.info("Spotify tops failed for %s: %s", connection.user_id, exc)
        return None
    artists = [
        {
            "id": a.get("id"),
            "name": a.get("name"),
            "image_url": best_image(a.get("images"), 160),
            "genres": [g for g in a.get("genres") or [] if isinstance(g, str)][:3],
            "plays": None,
            "url": (a.get("external_urls") or {}).get("spotify"),
        }
        for a in artists_raw.get("items") or []
        if isinstance(a, dict) and a.get("name")
    ]
    tracks = []
    for t in tracks_raw.get("items") or []:
        payload = _track_payload(t) if isinstance(t, dict) else None
        if payload:
            payload["plays"] = None
            tracks.append(payload)
    result = {"artists": artists, "tracks": tracks}
    await _cache_set(key, result, TOP_TTL)
    return result


# --- Local history -------------------------------------------------------------------------


def event_payload(ev: ListeningEvent) -> dict[str, Any]:
    return {
        "id": str(ev.id),
        "track_id": ev.track_id,
        "name": ev.track_name,
        "artists": list(ev.artists or []),
        "album": ev.album,
        "image_url": ev.image_url,
        "duration_ms": ev.duration_ms,
        "played_at": ev.played_at.isoformat(),
        "source": ev.source,
        "genres": list(ev.genres or [])[:3],
        "url": f"https://open.spotify.com/track/{ev.track_id}" if ev.source == "spotify" else None,
    }


async def recent_events(
    db: AsyncSession, user_id: Any, limit: int = 50, before: datetime | None = None
) -> list[ListeningEvent]:
    stmt = select(ListeningEvent).where(ListeningEvent.user_id == user_id)
    if before is not None:
        stmt = stmt.where(ListeningEvent.played_at < before)
    stmt = stmt.order_by(ListeningEvent.played_at.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def history_tops(
    db: AsyncSession, user_id: Any, since: datetime
) -> dict[str, list[dict[str, Any]]]:
    base = (ListeningEvent.user_id == user_id, ListeningEvent.played_at >= since)
    plays = func.count().label("plays")
    artist_rows = (
        await db.execute(
            select(ListeningEvent.artist_name, plays, func.max(ListeningEvent.image_url))
            .where(*base, ListeningEvent.artist_name.is_not(None))
            .group_by(ListeningEvent.artist_name)
            .order_by(plays.desc(), ListeningEvent.artist_name)
            .limit(10)
        )
    ).all()
    track_rows = (
        await db.execute(
            select(
                ListeningEvent.track_id,
                func.max(ListeningEvent.track_name),
                func.max(ListeningEvent.artist_name),
                func.max(ListeningEvent.album),
                func.max(ListeningEvent.image_url),
                plays,
            )
            .where(*base)
            .group_by(ListeningEvent.track_id)
            .order_by(plays.desc(), func.max(ListeningEvent.played_at).desc())
            .limit(10)
        )
    ).all()
    return {
        "artists": [
            {"id": None, "name": name, "image_url": img, "genres": [], "plays": n, "url": None}
            for name, n, img in artist_rows
        ],
        "tracks": [
            {
                "track_id": tid,
                "name": name,
                "artists": [artist] if artist else [],
                "album": album,
                "image_url": img,
                "duration_ms": None,
                "url": f"https://open.spotify.com/track/{tid}",
                "plays": n,
            }
            for tid, name, artist, album, img, n in track_rows
        ],
    }


def mood_payload(row: ListeningMood) -> dict[str, Any]:
    labels = list(row.moods or [])
    key = mood_key(labels[0] if labels else None)
    return {
        "date": row.day.isoformat(),
        "moods": labels,
        "mood_keys": [mood_key(m) for m in labels],
        "mood_key": key,
        "color": mood_color(labels[0] if labels else None),
        "energy": round(row.energy, 3),
        "valence": round(row.valence, 3),
        "top_genres": list(row.top_genres or []),
        "track_count": row.track_count,
        "minutes": round((row.listened_ms or 0) / 60000),
        "dominant_artists": list(row.dominant_artists or []),
        "one_liner": row.one_liner or one_liner_for(key, (row.dominant_artists or [None])[0]),
        "method": row.method,
    }


async def _local_days_with_plays(
    db: AsyncSession, user_id: Any, zone: ZoneInfo, since: datetime
) -> set[date]:
    local = cast(func.timezone(zone.key, ListeningEvent.played_at), Date)
    rows = (
        await db.execute(
            select(local)
            .where(ListeningEvent.user_id == user_id, ListeningEvent.played_at >= since)
            .group_by(local)
        )
    ).scalars()
    return set(rows)


async def _mood_rows(db: AsyncSession, user_id: Any, start: date, end: date) -> list[ListeningMood]:
    stmt = (
        select(ListeningMood)
        .where(
            ListeningMood.user_id == user_id,
            ListeningMood.day >= start,
            ListeningMood.day <= end,
        )
        .order_by(ListeningMood.day)
    )
    return list((await db.execute(stmt)).scalars().all())


async def mood_timeline(
    db: AsyncSession, user_id: Any, zone: ZoneInfo, start: date, end: date
) -> list[ListeningMood]:
    """Daily mood rows for [start, end].

    Self-heals days that have plays but no mood row (e.g. history written
    before a timezone change) by computing them on the fly.
    """
    rows = await _mood_rows(db, user_id, start, end)
    since, _ = local_day_bounds(start, zone)
    have = {r.day for r in rows}
    missing = {
        d
        for d in await _local_days_with_plays(db, user_id, zone, since)
        if start <= d <= end and d not in have
    }
    if not missing:
        return rows
    await recompute_days(db, user_id, zone, missing)
    await db.commit()
    return await _mood_rows(db, user_id, start, end)


def genre_breakdown(rows: list[ListeningMood], limit: int = 8) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for row in rows:
        for genre, n in (row.genre_counts or {}).items():
            counts[genre] += int(n or 0)
    total = sum(counts.values())
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [
        {"genre": g, "count": n, "share": round(n / total, 3) if total else 0.0} for g, n in ordered
    ]


async def stats(
    db: AsyncSession, user_id: Any, since: datetime, rows: list[ListeningMood]
) -> dict[str, Any]:
    uniq = (
        await db.execute(
            select(
                func.count(func.distinct(ListeningEvent.track_id)),
                func.count(func.distinct(ListeningEvent.artist_name)),
            ).where(ListeningEvent.user_id == user_id, ListeningEvent.played_at >= since)
        )
    ).one()
    mood_counts = Counter(mood_key((r.moods or [None])[0]) for r in rows)
    top_mood = (
        sorted(mood_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if mood_counts else None
    )
    energies = [r.energy for r in rows]
    valences = [r.valence for r in rows]
    return {
        "plays": sum(r.track_count for r in rows),
        "minutes": round(sum(r.listened_ms or 0 for r in rows) / 60000),
        "unique_tracks": int(uniq[0] or 0),
        "unique_artists": int(uniq[1] or 0),
        "active_days": len([r for r in rows if r.track_count]),
        "top_mood": top_mood,
        "avg_energy": round(sum(energies) / len(energies), 3) if energies else None,
        "avg_valence": round(sum(valences) / len(valences), 3) if valences else None,
    }


# --- Outfits by day --------------------------------------------------------------------------


def _outfit_day(outfit: Outfit, zone: ZoneInfo) -> date | None:
    fb = outfit.feedback
    if fb is not None and fb.worn_at:
        return fb.worn_at
    if outfit.status != OutfitStatus.accepted:
        return None
    if outfit.scheduled_for:
        return outfit.scheduled_for
    ts = outfit.responded_at or outfit.created_at
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(zone).date()


async def outfits_by_day(
    db: AsyncSession, user_id: Any, zone: ZoneInfo, start: date, end: date
) -> dict[date, list[dict[str, Any]]]:
    """Accepted / worn outfits keyed by the local day they were (to be) worn."""
    since, _ = local_day_bounds(start - timedelta(days=1), zone)
    stmt = (
        select(Outfit)
        .outerjoin(UserFeedback, UserFeedback.outfit_id == Outfit.id)
        .where(
            Outfit.user_id == user_id,
            or_(Outfit.status == OutfitStatus.accepted, UserFeedback.worn_at.is_not(None)),
            or_(
                Outfit.scheduled_for >= start,
                UserFeedback.worn_at >= start,
                Outfit.responded_at >= since,
                Outfit.created_at >= since,
            ),
        )
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
        )
        .order_by(Outfit.created_at)
    )
    out: dict[date, list[dict[str, Any]]] = {}
    for outfit in (await db.execute(stmt)).scalars().unique().all():
        day = _outfit_day(outfit, zone)
        if day is None or not (start <= day <= end):
            continue
        thumbs = []
        for oi in sorted(outfit.items, key=lambda x: x.position)[:4]:
            path = oi.item.thumbnail_path or oi.item.image_path if oi.item else None
            if path:
                thumbs.append(sign_image_url(path))
        out.setdefault(day, []).append(
            {
                "id": str(outfit.id),
                "name": outfit.name,
                "occasion": outfit.occasion,
                "status": str(outfit.status.value if outfit.status else ""),
                "worn": bool(outfit.feedback and outfit.feedback.worn_at),
                "thumbnails": thumbs,
            }
        )
    return out


async def top_tracks_per_day(
    db: AsyncSession, user_id: Any, zone: ZoneInfo, days: list[date]
) -> dict[date, list[dict[str, Any]]]:
    if not days:
        return {}
    since, _ = local_day_bounds(min(days), zone)
    _, until = local_day_bounds(max(days), zone)
    local = cast(func.timezone(zone.key, ListeningEvent.played_at), Date).label("d")
    plays = func.count().label("plays")
    rows = (
        await db.execute(
            select(
                local,
                ListeningEvent.track_id,
                func.max(ListeningEvent.track_name),
                func.max(ListeningEvent.artist_name),
                func.max(ListeningEvent.image_url),
                plays,
            )
            .where(
                ListeningEvent.user_id == user_id,
                ListeningEvent.played_at >= since,
                ListeningEvent.played_at < until,
            )
            .group_by(local, ListeningEvent.track_id)
            .order_by(local, plays.desc())
        )
    ).all()
    wanted = set(days)
    out: dict[date, list[dict[str, Any]]] = {}
    for d, tid, name, artist, img, n in rows:
        if d not in wanted:
            continue
        bucket = out.setdefault(d, [])
        if len(bucket) < 3:
            bucket.append(
                {"track_id": tid, "name": name, "artist": artist, "image_url": img, "plays": n}
            )
    return out


# --- Search (Estilista autocomplete) --------------------------------------------------------

_WS = re.compile(r"\s+")


def normalise_query(q: str) -> str:
    return _WS.sub(" ", (q or "").strip())[:120]


async def search_spotify(
    db: AsyncSession, connection: SpotifyConnection, q: str
) -> list[dict[str, Any]] | None:
    key = f"music:search:spotify:{q.lower()}"
    cached = await _cache_get(key)
    if cached is not None:
        return cached
    try:
        items = await SpotifyClient(connection, db, timeout=5.0).search_tracks(q, SEARCH_LIMIT)
    except Exception as exc:
        logger.info("Spotify search failed (%s); using fallback", exc)
        return None
    results = []
    for t in items:
        payload = _track_payload(t)
        if payload:
            payload["source"] = "spotify"
            results.append(payload)
    await _cache_set(key, results, SEARCH_TTL_SPOTIFY)
    return results


async def search_fallback(q: str) -> list[dict[str, Any]]:
    """Last.fm track.search (with key) else MusicBrainz recordings. Never raises."""
    settings = get_settings()
    api_key = getattr(settings, "lastfm_api_key", None)
    source = "lastfm" if api_key else "musicbrainz"
    key = f"music:search:{source}:{q.lower()}"
    cached = await _cache_get(key)
    if cached is not None:
        return cached
    results: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as http:
            if api_key:
                resp = await http.get(
                    "https://ws.audioscrobbler.com/2.0/",
                    params={
                        "method": "track.search",
                        "track": q,
                        "api_key": api_key,
                        "format": "json",
                        "limit": SEARCH_LIMIT,
                    },
                )
                resp.raise_for_status()
                matches = ((resp.json().get("results") or {}).get("trackmatches") or {}).get(
                    "track"
                ) or []
                if isinstance(matches, dict):
                    matches = [matches]
                for m in matches[:SEARCH_LIMIT]:
                    if not isinstance(m, dict) or not m.get("name"):
                        continue
                    image = None
                    for img in m.get("image") or []:
                        url = img.get("#text") if isinstance(img, dict) else None
                        if url and LASTFM_PLACEHOLDER not in url:
                            image = url
                    results.append(
                        {
                            "track_id": None,
                            "name": m["name"],
                            "artists": [m["artist"]] if m.get("artist") else [],
                            "album": None,
                            "image_url": image,
                            "duration_ms": None,
                            "url": m.get("url"),
                            "source": "lastfm",
                        }
                    )
            else:
                resp = await http.get(
                    "https://musicbrainz.org/ws/2/recording",
                    params={"query": q, "fmt": "json", "limit": SEARCH_LIMIT},
                    headers={
                        "User-Agent": (
                            "Miaurmario/1.0 ( https://github.com/andreipopx/miaurmario )"
                        )
                    },
                )
                resp.raise_for_status()
                for rec in resp.json().get("recordings") or []:
                    if not isinstance(rec, dict) or not rec.get("title"):
                        continue
                    credits = [
                        c.get("name") for c in rec.get("artist-credit") or [] if isinstance(c, dict)
                    ]
                    releases = rec.get("releases") or []
                    release = releases[0] if releases and isinstance(releases[0], dict) else {}
                    results.append(
                        {
                            "track_id": None,
                            "name": rec["title"],
                            "artists": [c for c in credits if c],
                            "album": release.get("title"),
                            "image_url": (
                                f"https://coverartarchive.org/release/{release['id']}/front-250"
                                if release.get("id")
                                else None
                            ),
                            "duration_ms": rec.get("length"),
                            "url": None,
                            "source": "musicbrainz",
                        }
                    )
    except Exception as exc:
        logger.info("Music search fallback (%s) failed: %s", source, exc)
        return []
    await _cache_set(key, results, SEARCH_TTL_FALLBACK)
    return results
