"""Persist Spotify listening history (recently-played) into ``listening_events``.

Spotify only keeps ~the last 50 plays behind /me/player/recently-played, so a
worker cron (every 30 min) and an on-demand, throttled sync from the Música tab
copy them here. The ``after`` cursor (epoch ms) lives on the SpotifyConnection;
rows are upserted with ON CONFLICT DO NOTHING on (user_id, track_id, played_at)
so re-syncing the same window is idempotent.

Artist genres come from single GET /artists/{id} calls (the batch endpoint was
removed), cached in Redis for a week and capped per sync to stay well inside
the rate limit.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.spotify.client import SpotifyAPIError, SpotifyClient
from app.models.music import ListeningEvent
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.services.listening_dedupe import drop_cross_source_duplicates
from app.services.listening_mood import local_day, recompute_days, user_zone
from app.services.music_service import _extract_year

logger = logging.getLogger(__name__)

RECENT_LIMIT = 50
MAX_PAGES = 4
MAX_ARTIST_LOOKUPS = 25
ON_DEMAND_ARTIST_LOOKUPS = 10
ON_DEMAND_MIN_INTERVAL = timedelta(minutes=2)
ARTIST_GENRES_TTL = 60 * 60 * 24 * 7
ARTIST_GENRES_PREFIX = "music:artist:genres"


@dataclass
class SyncResult:
    fetched: int = 0
    inserted: int = 0
    days: list[date] = field(default_factory=list)
    skipped: bool = False
    last_synced_at: datetime | None = None


def _to_ms(ts: datetime) -> int:
    return int(ts.timestamp() * 1000)


def _parse_played_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=UTC)


def best_image(images: list[dict[str, Any]] | None, target: int = 300) -> str | None:
    """Pick the smallest image at least `target` px wide (else the largest)."""
    imgs = [i for i in images or [] if isinstance(i, dict) and i.get("url")]
    if not imgs:
        return None
    imgs.sort(key=lambda i: i.get("width") or 0)
    for img in imgs:
        if (img.get("width") or 0) >= target:
            return img["url"]
    return imgs[-1]["url"]


def parse_track(track: dict[str, Any]) -> dict[str, Any] | None:
    """Normalise a Spotify track object; None for local files / podcasts."""
    if not isinstance(track, dict) or not track.get("id") or not track.get("name"):
        return None
    artists = [a for a in track.get("artists") or [] if isinstance(a, dict) and a.get("name")]
    album = track.get("album") if isinstance(track.get("album"), dict) else {}
    year = _extract_year(album.get("release_date")) if album else None
    return {
        "track_id": str(track["id"])[:64],
        "track_name": str(track["name"])[:300],
        "artist_id": (str(artists[0].get("id"))[:64] if artists and artists[0].get("id") else None),
        "artist_name": str(artists[0]["name"])[:300] if artists else None,
        "artists": [str(a["name"])[:300] for a in artists][:8],
        "album": str(album.get("name"))[:300] if album and album.get("name") else None,
        "release_year": int(year) if year else None,
        "image_url": best_image(album.get("images") if album else None),
        "duration_ms": int(track["duration_ms"]) if track.get("duration_ms") else None,
        "url": (track.get("external_urls") or {}).get("spotify"),
    }


def parse_play(item: dict[str, Any]) -> dict[str, Any] | None:
    played_at = _parse_played_at(item.get("played_at") if isinstance(item, dict) else None)
    track = parse_track(item.get("track") if isinstance(item, dict) else None)  # type: ignore[arg-type]
    if played_at is None or track is None:
        return None
    track.pop("url", None)
    track["played_at"] = played_at
    return track


async def _cached_genres(artist_id: str) -> list[str] | None:
    try:
        from app.utils.redis_lock import get_redis

        raw = await (await get_redis()).get(f"{ARTIST_GENRES_PREFIX}:{artist_id}")
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def _store_genres(artist_id: str, genres: list[str]) -> None:
    try:
        from app.utils.redis_lock import get_redis

        await (await get_redis()).set(
            f"{ARTIST_GENRES_PREFIX}:{artist_id}", json.dumps(genres), ex=ARTIST_GENRES_TTL
        )
    except Exception:
        logger.debug("artist genre cache write failed", exc_info=True)


async def artist_genres(
    db: AsyncSession,
    client: SpotifyClient,
    user_id: Any,
    artist_ids: list[str],
    budget: int,
) -> dict[str, list[str]]:
    """Genres per artist: Redis cache → the user's own history → Spotify (≤ budget calls)."""
    out: dict[str, list[str]] = {}
    missing: list[str] = []
    for aid in dict.fromkeys(artist_ids):
        cached = await _cached_genres(aid)
        if cached is not None:
            out[aid] = cached
        else:
            missing.append(aid)
    if missing:
        rows = (
            await db.execute(
                select(ListeningEvent.artist_id, ListeningEvent.genres)
                .where(
                    ListeningEvent.user_id == user_id,
                    ListeningEvent.artist_id.in_(missing),
                )
                .order_by(ListeningEvent.played_at.desc())
            )
        ).all()
        for aid, genres in rows:
            if aid not in out and genres:
                out[aid] = list(genres)
        missing = [a for a in missing if a not in out]
    for aid in missing[:budget]:
        try:
            artist = await client.get_artist(aid)
        except SpotifyAPIError as exc:
            if exc.status_code == 429:
                break
            logger.debug("Spotify artist %s lookup failed: %s", aid, exc)
            continue
        except Exception as exc:
            logger.debug("Spotify artist %s lookup failed: %s", aid, exc)
            continue
        genres = [g for g in artist.get("genres") or [] if isinstance(g, str)][:8]
        out[aid] = genres
        await _store_genres(aid, genres)
    return out


async def sync_listening_history(
    db: AsyncSession,
    connection: SpotifyConnection,
    *,
    tz_name: str | None = None,
    client: SpotifyClient | None = None,
    artist_lookups: int = MAX_ARTIST_LOOKUPS,
) -> SyncResult:
    """Fetch recently-played after the stored cursor and upsert it. Commits.

    Raises SpotifyAPIError when Spotify refuses (the caller decides what to do).
    """
    client = client or SpotifyClient(connection, db)
    zone = user_zone(tz_name)
    result = SyncResult()

    cursor = connection.history_cursor_ms
    plays: list[dict[str, Any]] = []
    for _ in range(MAX_PAGES):
        page = await client.get_recently_played(limit=RECENT_LIMIT, after=cursor)
        items = [p for p in (parse_play(i) for i in page.get("items") or []) if p]
        result.fetched += len(items)
        plays.extend(items)
        if not items:
            break
        newest = max(_to_ms(p["played_at"]) for p in items)
        # First sync (no cursor) returns the newest 50 — nothing older exists.
        if cursor is None or len(items) < RECENT_LIMIT or newest <= (cursor or 0):
            cursor = max(newest, cursor or 0)
            break
        cursor = newest

    # Same play already imported from Last.fm (Spotify → Last.fm scrobbling)?
    plays = await drop_cross_source_duplicates(db, connection.user_id, plays, "spotify")
    if plays:
        genres = await artist_genres(
            db,
            client,
            connection.user_id,
            [p["artist_id"] for p in plays if p.get("artist_id")],
            artist_lookups,
        )
        rows = [
            {
                **p,
                "user_id": connection.user_id,
                "source": "spotify",
                "genres": genres.get(p.get("artist_id") or "", []),
            }
            for p in plays
        ]
        stmt = (
            pg_insert(ListeningEvent)
            .values(rows)
            .on_conflict_do_nothing(constraint="uq_listening_events_play")
            .returning(ListeningEvent.played_at)
        )
        inserted = (await db.execute(stmt)).scalars().all()
        result.inserted = len(inserted)
        result.days = sorted({local_day(ts, zone) for ts in inserted})
        if result.days:
            await recompute_days(db, connection.user_id, zone, result.days)

    if cursor is not None:
        connection.history_cursor_ms = max(cursor, connection.history_cursor_ms or 0)
    now = datetime.now(UTC)
    connection.last_history_sync_at = now
    result.last_synced_at = now
    await db.commit()
    return result


async def maybe_sync(
    db: AsyncSession,
    connection: SpotifyConnection,
    user: User,
    *,
    min_interval: timedelta = ON_DEMAND_MIN_INTERVAL,
) -> SyncResult:
    """On-demand sync (Música tab), throttled to one per `min_interval`."""
    last = connection.last_history_sync_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        if datetime.now(UTC) - last < min_interval:
            return SyncResult(skipped=True, last_synced_at=last)
    return await sync_listening_history(
        db, connection, tz_name=user.timezone, artist_lookups=ON_DEMAND_ARTIST_LOOKUPS
    )
