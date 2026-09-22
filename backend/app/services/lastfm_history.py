"""Last.fm as a music source: history sync, tops, now playing, mood context.

Spotify's development mode caps the app at 5 allow-listed users, so everybody
else connects Last.fm (Spotify → Last.fm scrobbling works for any Spotify
account) and this module fills the same ``listening_events`` table with
``source='lastfm'``. Everything downstream (daily mood, /music/overview, the
Stylist's SongContext, Stinky's chat tool) reads that table and does not care
where a play came from.

- History: ``user.getRecentTracks`` (200 per page, ``from`` = stored cursor,
  ``extended=1``). The "now playing" pseudo-entry has no timestamp and is never
  stored. Rows are upserted with ON CONFLICT DO NOTHING on
  (user_id, track_id, played_at); ``track_id`` is a stable hash of
  "artist | title" because scrobbles rarely carry an id. Plays already
  imported from Spotify are skipped (see ``listening_dedupe``).
- Genres: ``artist.getTopTags`` (cached a week in Redis), budgeted per sync and
  back-filled on later syncs for plays that were stored without tags.
- Tops: ``user.getTopArtists`` / ``user.getTopTracks`` with period 7day /
  1month / 6month for the 7d / 30d / 6m ranges.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.lastfm.client import LastfmClient, LastfmError, LastfmRateLimited
from app.models.lastfm import LastfmConnection
from app.models.music import ListeningEvent
from app.models.user import User
from app.services.listening_dedupe import drop_cross_source_duplicates, track_key_id
from app.services.listening_history import SyncResult
from app.services.listening_mood import local_day, recompute_days, user_zone
from app.services.music_service import GENERIC_TAGS, SongContext, lastfm_tags

logger = logging.getLogger(__name__)

PERIODS: dict[str, str] = {"7d": "7day", "30d": "1month", "6m": "6month"}
RECENT_LIMIT = 200
MAX_PAGES = 5
FIRST_SYNC_DAYS = 30
TAG_LOOKUPS = 25
ON_DEMAND_TAG_LOOKUPS = 8
BACKFILL_DAYS = 30
ON_DEMAND_MIN_INTERVAL = timedelta(minutes=2)
TAGS_TTL = 60 * 60 * 24 * 7
TAGS_PREFIX = "music:lastfm:artist:tags"
NOW_TTL = 20
TOP_TTL = 60 * 60
MOOD_TTL = 300
MIN_TAG_COUNT = 10  # Last.fm tag counts are relative (0-100)
PLACEHOLDER_IMAGE = "2a96cbd8b46e442fc41c2b86b821562f"
IMAGE_ORDER = ("extralarge", "mega", "large", "medium", "small")


def now_cache_key(user_id: Any) -> str:
    return f"music:now:lastfm:{user_id}"


def top_cache_key(user_id: Any, range_key: str) -> str:
    return f"music:top:lastfm:{user_id}:{range_key}"


def mood_cache_key(user_id: Any) -> str:
    return f"music:lastfm:mood:{user_id}"


# --- tiny Redis JSON cache ----------------------------------------------------------------


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
        logger.debug("lastfm cache write failed", exc_info=True)


async def clear_cache(user_id: Any) -> None:
    try:
        from app.utils.redis_lock import get_redis

        keys = [now_cache_key(user_id), mood_cache_key(user_id)] + [
            top_cache_key(user_id, r) for r in PERIODS
        ]
        await (await get_redis()).delete(*keys)
    except Exception:
        logger.debug("lastfm cache clear failed", exc_info=True)


# --- parsing ------------------------------------------------------------------------------


def client_for(connection: LastfmConnection, timeout: float | None = None) -> LastfmClient:
    session_key = None
    if connection.session_key_ct:
        try:
            from app.integrations.crypto import decrypt_token

            session_key = decrypt_token(connection.session_key_ct)
        except Exception:
            logger.info("Last.fm session key unreadable for %s; using public API", connection.id)
    kwargs: dict[str, Any] = {"session_key": session_key}
    if timeout is not None:
        kwargs["timeout"] = timeout
    return LastfmClient(**kwargs)


def _text(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("name") or value.get("#text")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _mbid(value: Any) -> str | None:
    if isinstance(value, dict):
        mbid = str(value.get("mbid") or "").strip()
        return mbid[:64] or None
    return None


def pick_image(images: Any) -> str | None:
    by_size: dict[str, str] = {}
    for img in images if isinstance(images, list) else []:
        if not isinstance(img, dict):
            continue
        url = str(img.get("#text") or "").strip()
        if url and PLACEHOLDER_IMAGE not in url:
            by_size[str(img.get("size") or "")] = url
    for size in IMAGE_ORDER:
        if size in by_size:
            return by_size[size][:500]
    return next(iter(by_size.values()), None)


def is_now_playing(track: dict[str, Any]) -> bool:
    attr = track.get("@attr") if isinstance(track, dict) else None
    return isinstance(attr, dict) and str(attr.get("nowplaying", "")).lower() == "true"


def parse_scrobble(track: dict[str, Any]) -> dict[str, Any] | None:
    """A stored play from a getRecentTracks entry; None for now-playing / junk."""
    if not isinstance(track, dict) or is_now_playing(track):
        return None
    name = _text(track.get("name"))
    artist = _text(track.get("artist"))
    date = track.get("date")
    uts = date.get("uts") if isinstance(date, dict) else None
    try:
        played_at = datetime.fromtimestamp(int(uts), tz=UTC)
    except (TypeError, ValueError, OverflowError, OSError):
        return None
    if not name or not artist:
        return None
    album = _text(track.get("album"))
    return {
        "played_at": played_at,
        "track_id": track_key_id(artist, name),
        "track_name": name[:300],
        "artist_id": _mbid(track.get("artist")),
        "artist_name": artist[:300],
        "artists": [artist[:300]],
        "album": album[:300] if album else None,
        "release_year": None,
        "image_url": pick_image(track.get("image")),
        "duration_ms": None,
    }


def track_payload(track: dict[str, Any]) -> dict[str, Any] | None:
    """Now-playing / top-track shape shared with the Spotify payloads."""
    name = _text(track.get("name")) if isinstance(track, dict) else None
    if not name:
        return None
    artist = _text(track.get("artist"))
    album = _text(track.get("album"))
    duration = track.get("duration")
    try:
        duration_ms = int(duration) * 1000 if duration and int(duration) > 0 else None
    except (TypeError, ValueError):
        duration_ms = None
    return {
        "track_id": None,
        "name": name,
        "artists": [artist] if artist else [],
        "album": album,
        "image_url": pick_image(track.get("image")),
        "duration_ms": duration_ms,
        "url": track.get("url") or None,
        "source": "lastfm",
    }


def clean_artist_tags(raw: list[dict[str, Any]], limit: int = 5) -> list[str]:
    out: list[str] = []
    for tag in raw:
        name = str(tag.get("name") or "").strip().lower() if isinstance(tag, dict) else ""
        try:
            count = int(tag.get("count", 100))
        except (TypeError, ValueError):
            count = 0
        if not name or name in GENERIC_TAGS or count < MIN_TAG_COUNT or len(name) > 40:
            continue
        if name not in out:
            out.append(name)
        if len(out) >= limit:
            break
    return out


# --- artist tags → genres -------------------------------------------------------------------


@dataclass
class _Budget:
    calls: int


async def artist_tags(
    db: AsyncSession | None,
    client: LastfmClient,
    user_id: Any,
    artists: list[str],
    budget: _Budget,
) -> dict[str, list[str]]:
    """Genres per artist name: Redis → the user's own history → Last.fm (≤ budget)."""
    out: dict[str, list[str]] = {}
    missing: list[str] = []
    for name in dict.fromkeys(a for a in artists if a):
        cached = await _cache_get(f"{TAGS_PREFIX}:{name.casefold()}")
        if cached is not None:
            out[name] = cached
        else:
            missing.append(name)
    if missing and db is not None:
        rows = (
            await db.execute(
                select(ListeningEvent.artist_name, ListeningEvent.genres)
                .where(
                    ListeningEvent.user_id == user_id,
                    ListeningEvent.artist_name.in_(missing),
                    func.jsonb_array_length(ListeningEvent.genres) > 0,
                )
                .order_by(ListeningEvent.played_at.desc())
            )
        ).all()
        for name, genres in rows:
            if name not in out and genres:
                out[name] = list(genres)
        missing = [a for a in missing if a not in out]
    for name in missing:
        if budget.calls <= 0:
            break
        budget.calls -= 1
        try:
            tags = clean_artist_tags(await client.artist_top_tags(name))
        except LastfmRateLimited:
            budget.calls = 0
            break
        except LastfmError as exc:
            logger.debug("Last.fm tags for %r failed: %s", name, exc)
            tags = []
        out[name] = tags
        await _cache_set(f"{TAGS_PREFIX}:{name.casefold()}", tags, TAGS_TTL)
    return out


async def backfill_genres(
    db: AsyncSession, client: LastfmClient, user_id: Any, budget: _Budget
) -> list[datetime]:
    """Tag recent Last.fm plays stored without genres. Returns their played_at."""
    if budget.calls <= 0:
        return []
    since = datetime.now(UTC) - timedelta(days=BACKFILL_DAYS)
    empty = func.jsonb_array_length(ListeningEvent.genres) == 0
    names = (
        (
            await db.execute(
                select(ListeningEvent.artist_name)
                .where(
                    ListeningEvent.user_id == user_id,
                    ListeningEvent.source == "lastfm",
                    empty,
                    ListeningEvent.artist_name.is_not(None),
                    ListeningEvent.played_at >= since,
                )
                .group_by(ListeningEvent.artist_name)
                .order_by(func.max(ListeningEvent.played_at).desc())
                .limit(60)
            )
        )
        .scalars()
        .all()
    )
    if not names:
        return []
    tags = await artist_tags(None, client, user_id, list(names), budget)
    touched: list[datetime] = []
    for name, genres in tags.items():
        if not genres:
            continue
        stmt = (
            update(ListeningEvent)
            .where(
                ListeningEvent.user_id == user_id,
                ListeningEvent.source == "lastfm",
                ListeningEvent.artist_name == name,
                empty,
            )
            .values(genres=genres)
            .returning(ListeningEvent.played_at)
        )
        touched.extend((await db.execute(stmt)).scalars().all())
    return touched


# --- history sync ------------------------------------------------------------------------------


async def sync_lastfm_history(
    db: AsyncSession,
    connection: LastfmConnection,
    *,
    tz_name: str | None = None,
    client: LastfmClient | None = None,
    tag_lookups: int = TAG_LOOKUPS,
    max_pages: int = MAX_PAGES,
) -> SyncResult:
    """Fetch scrobbles after the stored cursor and upsert them. Commits.

    Raises LastfmError (private / not found / rate limited...) for the caller.

    When more pages are pending than ``max_pages`` (first sync of a heavy
    listener, or the worker was down), the *oldest* pages are fetched and the
    cursor only advances over them, so later runs continue without gaps.
    """
    client = client or client_for(connection)
    zone = user_zone(tz_name)
    result = SyncResult()
    now = datetime.now(UTC)

    if connection.cursor_uts is not None:
        from_uts = int(connection.cursor_uts) + 1
    else:
        from_uts = int((now - timedelta(days=FIRST_SYNC_DAYS)).timestamp())

    first = await client.recent_tracks(
        connection.username, limit=RECENT_LIMIT, page=1, from_uts=from_uts
    )
    total_pages = max(1, first["total_pages"])
    pages: dict[int, list[dict[str, Any]]] = {1: first["tracks"]}
    if total_pages <= max_pages:
        wanted = list(range(2, total_pages + 1))
        cursor_pages = set(range(1, total_pages + 1))
    else:
        # Oldest pages first (page N is the oldest), contiguous from the cursor.
        wanted = list(range(total_pages, total_pages - max(1, max_pages - 1), -1))
        cursor_pages = set(wanted)
    for page in wanted:
        data = await client.recent_tracks(
            connection.username, limit=RECENT_LIMIT, page=page, from_uts=from_uts
        )
        pages[page] = data["tracks"]

    plays: list[dict[str, Any]] = []
    seen: set[tuple[str, datetime]] = set()
    cursor = connection.cursor_uts
    for page, tracks in pages.items():
        for raw in tracks:
            play = parse_scrobble(raw)
            if play is None:
                continue
            uts = int(play["played_at"].timestamp())
            if page in cursor_pages:
                cursor = max(cursor or 0, uts)
            key = (play["track_id"], play["played_at"])
            if key in seen:
                continue
            seen.add(key)
            plays.append(play)
    result.fetched = len(plays)

    plays = await drop_cross_source_duplicates(db, connection.user_id, plays, "lastfm")
    budget = _Budget(tag_lookups)
    touched: list[datetime] = []
    if plays:
        tags = await artist_tags(
            db, client, connection.user_id, [p["artist_name"] for p in plays], budget
        )
        rows = [
            {
                **p,
                "user_id": connection.user_id,
                "source": "lastfm",
                "genres": tags.get(p["artist_name"], []),
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
        touched.extend(inserted)
    touched.extend(await backfill_genres(db, client, connection.user_id, budget))

    result.days = sorted({local_day(ts, zone) for ts in touched})
    if result.days:
        await recompute_days(db, connection.user_id, zone, result.days)

    if cursor is not None:
        connection.cursor_uts = max(int(cursor), int(connection.cursor_uts or 0))
    connection.last_sync_at = now
    connection.last_error = None
    result.last_synced_at = now
    await db.commit()
    return result


async def maybe_sync(
    db: AsyncSession,
    connection: LastfmConnection,
    user: User,
    *,
    min_interval: timedelta = ON_DEMAND_MIN_INTERVAL,
) -> SyncResult:
    """On-demand sync (Música tab), throttled to one per `min_interval`."""
    last = connection.last_sync_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        if datetime.now(UTC) - last < min_interval:
            return SyncResult(skipped=True, last_synced_at=last)
    return await sync_lastfm_history(
        db, connection, tz_name=user.timezone, tag_lookups=ON_DEMAND_TAG_LOOKUPS, max_pages=2
    )


# --- live reads ---------------------------------------------------------------------------------


async def now_playing(connection: LastfmConnection) -> dict[str, Any] | None:
    """The scrobbler's "now playing" entry (20 s cache). None when idle / on error."""
    key = now_cache_key(connection.user_id)
    cached = await _cache_get(key)
    if cached is not None:
        return cached or None
    payload: dict[str, Any] | None = None
    try:
        data = await client_for(connection, timeout=5.0).recent_tracks(connection.username, limit=1)
        current = next((t for t in data["tracks"] if is_now_playing(t)), None)
        if current is not None:
            payload = track_payload(current)
            if payload:
                payload["is_playing"] = True
                payload["progress_ms"] = None
    except Exception as exc:
        logger.info("Last.fm now-playing failed for %s: %s", connection.user_id, exc)
        return None
    await _cache_set(key, payload or {}, NOW_TTL)
    return payload


async def tops(connection: LastfmConnection, range_key: str) -> dict[str, list] | None:
    period = PERIODS.get(range_key)
    if period is None:
        return None
    key = top_cache_key(connection.user_id, range_key)
    cached = await _cache_get(key)
    if cached:
        return cached
    client = client_for(connection, timeout=8.0)
    try:
        artists_raw = await client.top_artists(connection.username, period, limit=10)
        tracks_raw = await client.top_tracks(connection.username, period, limit=10)
    except Exception as exc:
        logger.info("Last.fm tops failed for %s: %s", connection.user_id, exc)
        return None

    def _plays(v: Any) -> int | None:
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    artists = [
        {
            "id": _mbid(a),
            "name": a.get("name"),
            "image_url": pick_image(a.get("image")),
            "genres": [],
            "plays": _plays(a.get("playcount")),
            "url": a.get("url"),
        }
        for a in artists_raw
        if isinstance(a, dict) and a.get("name")
    ]
    tracks = []
    for t in tracks_raw:
        payload = track_payload(t) if isinstance(t, dict) else None
        if payload:
            payload["plays"] = _plays(t.get("playcount"))
            tracks.append(payload)
    result = {"artists": artists, "tracks": tracks}
    await _cache_set(key, result, TOP_TTL)
    return result


async def listening_mood(db: AsyncSession, connection: LastfmConnection) -> SongContext | None:
    """Stylist mood input from the scrobbler: now playing / last play + top artists."""
    key = mood_cache_key(connection.user_id)
    cached = await _cache_get(key)
    if cached:
        try:
            return SongContext(**cached)
        except Exception:
            pass
    client = client_for(connection, timeout=5.0)
    track: dict[str, Any] | None = None
    listening: str | None = None
    try:
        data = await client.recent_tracks(connection.username, limit=1)
        if data["tracks"]:
            track = data["tracks"][0]
            listening = "now_playing" if is_now_playing(track) else "recently_played"
    except Exception as exc:
        logger.info("Last.fm listening lookup failed for %s: %s", connection.user_id, exc)
        return None

    top_names: list[str] = []
    try:
        top_names = [
            str(a["name"])
            for a in await client.top_artists(connection.username, "7day", limit=5)
            if isinstance(a, dict) and a.get("name")
        ]
    except Exception as exc:
        logger.debug("Last.fm top artists failed: %s", exc)

    artist = _text(track.get("artist")) if track else None
    name = _text(track.get("name")) if track else None
    if not name and not top_names:
        return None
    tag_map = await artist_tags(
        db, client, connection.user_id, [a for a in [artist, *top_names] if a], _Budget(3)
    )
    genres: list[str] = []
    for a in [artist, *top_names]:
        for g in tag_map.get(a or "", []):
            if g not in genres:
                genres.append(g)
    ctx = SongContext(
        query=f"{artist} — {name}" if artist and name else (name or "Last.fm"),
        artist=artist,
        track=name,
        album=_text(track.get("album")) if track else None,
        genres=genres[:6],
        tags=await lastfm_tags(artist, name),
        source="lastfm",
        listening=listening or "top_artists",
        top_artists=top_names[:5],
    )
    await _cache_set(key, ctx.model_dump(), MOOD_TTL)
    return ctx
