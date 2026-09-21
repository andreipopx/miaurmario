"""Music enrichment service.

Given a free-text query or a Spotify URL, resolve it against Last.fm (primary,
for emotional tags) and MusicBrainz (fallback, for canonical metadata) and
return a SongContext the Stylist can use as mood input.

APIs are called with tight timeouts and every failure is swallowed — this
service must never take down the /outfits/suggest endpoint.
"""

import json
import logging
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field

from app.config import get_settings
from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 60 * 60 * 24  # 24h
CACHE_PREFIX = "music:enrich"
REQUEST_TIMEOUT = 5.0
LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"
MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2"

# Last.fm tags are auto-generated and noisy; skip the ones that don't inform mood.
GENERIC_TAGS = {
    "seen live",
    "favorites",
    "favourites",
    "spotify",
    "under 2000 listeners",
    "albums i own",
    "all",
    "music",
    "singer-songwriter",  # too generic when it is the ONLY tag; kept if others present
}

SPOTIFY_TRACK_RE = re.compile(
    r"(?:open\.spotify\.com/(?:intl-[a-z]+/)?track/|spotify:track:)([A-Za-z0-9]+)"
)


class SongContext(BaseModel):
    """Enriched information about a song, used by the Stylist prompt."""

    query: str = Field(description="Original user input, verbatim")
    artist: str | None = None
    track: str | None = None
    album: str | None = None
    year: str | None = None
    genres: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list, description="Mood/emotion tags")
    source: str = Field(default="raw", description="spotify | lastfm | musicbrainz | raw")
    listening: str | None = Field(
        default=None,
        description="Spotify listening context: now_playing | recently_played (None for queries)",
    )
    top_artists: list[str] = Field(
        default_factory=list, description="User's recent top artists (Spotify only)"
    )

    @property
    def display_label(self) -> str:
        if self.artist and self.track:
            return f"{self.artist} — {self.track}"
        return self.query


def _parse_spotify_url(query: str) -> str | None:
    match = SPOTIFY_TRACK_RE.search(query)
    if match:
        return match.group(1)
    return None


def _split_artist_track(query: str) -> tuple[str | None, str | None]:
    """Heuristically split a free-text query into (artist, track).

    Supports "Artist - Track" and "Artist – Track" (em-dash).
    """
    for sep in [" - ", " – ", " — ", " by "]:
        if sep in query:
            parts = query.split(sep, 1)
            if len(parts) == 2:
                a, t = parts[0].strip(), parts[1].strip()
                if a and t:
                    return a, t
    return None, query.strip() or None


def _clean_tags(raw_tags: list[dict[str, Any]] | None, limit: int = 8) -> list[str]:
    if not raw_tags:
        return []
    cleaned: list[str] = []
    for entry in raw_tags:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not name or not isinstance(name, str):
            continue
        lower = name.strip().lower()
        if not lower or lower in GENERIC_TAGS:
            continue
        # Deduplicate case-insensitively while preserving first casing.
        if lower not in {c.lower() for c in cleaned}:
            cleaned.append(name.strip())
        if len(cleaned) >= limit:
            break
    return cleaned


async def _cache_get(key: str) -> SongContext | None:
    try:
        redis = await get_redis()
        raw = await redis.get(key)
        if not raw:
            return None
        return SongContext(**json.loads(raw))
    except Exception:
        logger.debug("music_service cache read failed", exc_info=True)
        return None


async def _cache_set(key: str, ctx: SongContext) -> None:
    try:
        redis = await get_redis()
        await redis.set(key, ctx.model_dump_json(), ex=CACHE_TTL_SECONDS)
    except Exception:
        logger.debug("music_service cache write failed", exc_info=True)


async def _lastfm_track_search(
    client: httpx.AsyncClient, api_key: str, query: str
) -> tuple[str, str] | None:
    """Fall back for free-text: search for the top matching track."""
    try:
        resp = await client.get(
            LASTFM_BASE,
            params={
                "method": "track.search",
                "track": query,
                "api_key": api_key,
                "format": "json",
                "limit": 1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        matches = data.get("results", {}).get("trackmatches", {}).get("track", [])
        if isinstance(matches, dict):
            matches = [matches]
        if not matches:
            return None
        first = matches[0]
        artist = first.get("artist")
        track = first.get("name")
        if artist and track:
            return artist, track
    except Exception:
        logger.debug("Last.fm search failed", exc_info=True)
    return None


async def _lastfm_get_info(
    client: httpx.AsyncClient, api_key: str, artist: str, track: str
) -> dict[str, Any] | None:
    try:
        resp = await client.get(
            LASTFM_BASE,
            params={
                "method": "track.getInfo",
                "artist": artist,
                "track": track,
                "api_key": api_key,
                "format": "json",
                "autocorrect": 1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("track")
    except Exception:
        logger.debug("Last.fm getInfo failed", exc_info=True)
        return None


async def _musicbrainz_search(
    client: httpx.AsyncClient, artist: str | None, track: str | None
) -> dict[str, Any] | None:
    if not track:
        return None
    query_parts = [f'recording:"{track}"']
    if artist:
        query_parts.append(f'artist:"{artist}"')
    query = " AND ".join(query_parts)
    try:
        resp = await client.get(
            f"{MUSICBRAINZ_BASE}/recording",
            params={"query": query, "fmt": "json", "limit": 1},
            headers={"User-Agent": "Miaurmario/1.0 ( https://github.com/andreipopx/miaurmario )"},
        )
        resp.raise_for_status()
        data = resp.json()
        recordings = data.get("recordings", [])
        if recordings:
            return recordings[0]
    except Exception:
        logger.debug("MusicBrainz search failed", exc_info=True)
    return None


def _extract_year(release_date: str | None) -> str | None:
    if not release_date:
        return None
    m = re.match(r"(\d{4})", release_date)
    return m.group(1) if m else None


async def _resolve_spotify(
    client: httpx.AsyncClient, spotify_id: str
) -> tuple[str | None, str | None]:
    """Spotify without OAuth: use the embed page's og:title which is
    "Track · Artist" style. Cheap and works for public tracks."""
    try:
        resp = await client.get(f"https://open.spotify.com/embed/track/{spotify_id}")
        resp.raise_for_status()
        html = resp.text
        # Preferred: parse the embedded JSON blob.
        m = re.search(r'"name"\s*:\s*"([^"]+)"[^{}]*?"artists"\s*:\s*\[([^\]]+)\]', html)
        if m:
            track = m.group(1)
            artists_blob = m.group(2)
            artist_match = re.search(r'"name"\s*:\s*"([^"]+)"', artists_blob)
            artist = artist_match.group(1) if artist_match else None
            if artist and track:
                return artist, track
        # Fallback: og:title = "Track - song by Artist | Spotify" (varies by locale).
        og = re.search(r'<meta property="og:title" content="([^"]+)"', html)
        og_desc = re.search(r'<meta property="og:description" content="([^"]+)"', html)
        if og:
            title = og.group(1)
            # "Artist - Song" or "Song"
            if " · " in title:
                a, t = title.split(" · ", 1)
                return a.strip(), t.strip()
            if og_desc and " · " in og_desc.group(1):
                a, t = og_desc.group(1).split(" · ", 1)
                return a.strip(), t.strip()
            return None, title
    except Exception:
        logger.debug("Spotify embed lookup failed", exc_info=True)
    return None, None


async def lastfm_tags(artist: str | None, track: str | None) -> list[str]:
    """Best-effort Last.fm mood tags for a resolved track ([] when unavailable)."""
    api_key = getattr(get_settings(), "lastfm_api_key", None)
    if not (api_key and artist and track):
        return []
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            info = await _lastfm_get_info(client, api_key, artist, track)
    except Exception:
        logger.debug("Last.fm tag lookup failed", exc_info=True)
        return []
    if not info:
        return []
    tags_root = info.get("toptags") or {}
    raw_tags = tags_root.get("tag") if isinstance(tags_root, dict) else None
    return _clean_tags(raw_tags if isinstance(raw_tags, list) else [])


async def resolve_music_context(
    db: Any, user: Any, song_query: str | None, song_track_id: str | None = None
) -> SongContext | None:
    """Pick the music mood input for a suggestion.

    - Exact Spotify track id (picked from the autocomplete) + Spotify connected:
      fetch that track directly instead of guessing from text.

    - Spotify connected + song query: resolve the query through the Spotify Web
      API (track URL or search) for canonical artist/genres; Last.fm adds tags.
      Falls back to the Last.fm/MusicBrainz path (`enrich_song`) on any failure.
    - Spotify connected (mood toggle on) + no query: derive the mood from what
      the user is playing now / played recently + top-artist genres.
    - Spotify not connected: identical to the previous behaviour — only a song
      query produces context, via `enrich_song`.

    Never raises.
    """
    # Local import: spotify_mood imports SongContext from this module.
    from app.services import spotify_mood

    connection = None
    try:
        connection = await spotify_mood.get_connection(db, user.id)
    except Exception:
        logger.debug("Spotify connection lookup failed", exc_info=True)

    if song_track_id and connection is not None:
        ctx = await spotify_mood.resolve_track_id(db, connection, song_track_id, song_query)
        if ctx is not None:
            return ctx

    if not (song_query and song_query.strip()) and song_track_id:
        # Not connected: the public embed page still resolves a track id.
        song_query = f"https://open.spotify.com/track/{song_track_id}"

    if song_query and song_query.strip():
        if connection is not None:
            ctx = await spotify_mood.resolve_query(db, connection, song_query)
            if ctx is not None:
                return ctx
        return await enrich_song(song_query)

    if connection is not None and connection.use_for_mood:
        return await spotify_mood.listening_mood(db, connection)
    return None


async def enrich_song(query: str) -> SongContext | None:
    """Resolve a free-text or Spotify-URL query to a SongContext.

    Returns None if the query is blank. Never raises — on failure returns a
    raw-text SongContext so the caller can still pass *something* to the LLM.
    """
    if not query or not query.strip():
        return None
    query = query.strip()
    if len(query) > 300:
        query = query[:300]

    cache_key = f"{CACHE_PREFIX}:{query.lower()}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    settings = get_settings()
    lastfm_key = getattr(settings, "lastfm_api_key", None)

    artist: str | None = None
    track: str | None = None

    spotify_id = _parse_spotify_url(query)

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
        if spotify_id:
            artist, track = await _resolve_spotify(client, spotify_id)
        if not (artist and track):
            heuristic_artist, heuristic_track = _split_artist_track(query)
            artist = artist or heuristic_artist
            track = track or heuristic_track

        # If we still don't have an artist and we have Last.fm, do a search.
        if lastfm_key and not artist and track:
            search = await _lastfm_track_search(client, lastfm_key, track)
            if search:
                artist, track = search

        lastfm_info: dict[str, Any] | None = None
        if lastfm_key and artist and track:
            lastfm_info = await _lastfm_get_info(client, lastfm_key, artist, track)

        # Build from Last.fm
        if lastfm_info:
            resolved_artist = None
            artist_field = lastfm_info.get("artist")
            if isinstance(artist_field, dict):
                resolved_artist = artist_field.get("name")
            elif isinstance(artist_field, str):
                resolved_artist = artist_field
            resolved_track = lastfm_info.get("name") or track

            album_field = lastfm_info.get("album") or {}
            album = album_field.get("title") if isinstance(album_field, dict) else None

            tags_root = lastfm_info.get("toptags") or {}
            raw_tags = tags_root.get("tag") if isinstance(tags_root, dict) else None
            tags = _clean_tags(raw_tags if isinstance(raw_tags, list) else [])

            ctx = SongContext(
                query=query,
                artist=resolved_artist or artist,
                track=resolved_track,
                album=album,
                tags=tags,
                source="lastfm",
            )

            # MusicBrainz only for missing year / genre canonicalisation.
            mb = await _musicbrainz_search(client, ctx.artist, ctx.track)
            if mb:
                releases = mb.get("releases") or []
                if releases:
                    ctx.year = _extract_year(releases[0].get("date")) or ctx.year
                mb_tags = mb.get("tags") or []
                mb_genre_names = [
                    t.get("name") for t in mb_tags if isinstance(t, dict) and t.get("name")
                ]
                for g in mb_genre_names[:4]:
                    if g and g.lower() not in {tg.lower() for tg in ctx.genres}:
                        ctx.genres.append(g)

            await _cache_set(cache_key, ctx)
            return ctx

        # Fallback: MusicBrainz only
        mb = await _musicbrainz_search(client, artist, track)
        if mb:
            resolved_artist = None
            artist_credits = mb.get("artist-credit") or []
            if artist_credits:
                first = artist_credits[0]
                if isinstance(first, dict):
                    resolved_artist = first.get("name") or (
                        first.get("artist", {}).get("name")
                        if isinstance(first.get("artist"), dict)
                        else None
                    )
            releases = mb.get("releases") or []
            first_release = releases[0] if releases else {}
            mb_tags = mb.get("tags") or []
            genre_names = [t.get("name") for t in mb_tags if isinstance(t, dict) and t.get("name")]

            ctx = SongContext(
                query=query,
                artist=resolved_artist or artist,
                track=mb.get("title") or track,
                album=first_release.get("title") if isinstance(first_release, dict) else None,
                year=_extract_year(first_release.get("date"))
                if isinstance(first_release, dict)
                else None,
                genres=genre_names[:4],
                tags=[],
                source="musicbrainz",
            )
            await _cache_set(cache_key, ctx)
            return ctx

    # Nothing resolved — return raw context so the LLM at least sees the query.
    ctx = SongContext(
        query=query,
        artist=artist,
        track=track,
        source="raw",
    )
    # Don't cache raw failures for the full 24h; makes retries cheaper if
    # the external API was just briefly down.
    return ctx


def format_song_context_for_prompt(ctx: SongContext) -> str:
    """Render a SongContext as a short bulleted block for the Stylist prompt."""
    lines = ["\nCONTEXTO MUSICAL (mood/estética a considerar):"]
    if ctx.listening == "now_playing" and ctx.artist and ctx.track:
        lines.append(f"- Escuchando ahora en Spotify: {ctx.artist} — {ctx.track}")
    elif ctx.listening == "recently_played" and ctx.artist and ctx.track:
        lines.append(f"- Escuchado recientemente en Spotify: {ctx.artist} — {ctx.track}")
    elif ctx.listening and not ctx.track:
        lines.append("- Hábitos de escucha recientes en Spotify")
    elif ctx.artist and ctx.track:
        lines.append(f"- Canción: {ctx.artist} — {ctx.track}")
    elif ctx.track:
        lines.append(f"- Canción: {ctx.track}")
    else:
        lines.append(f"- Referencia del usuario: {ctx.query}")
    if ctx.album:
        year = f" ({ctx.year})" if ctx.year else ""
        lines.append(f"- Álbum: {ctx.album}{year}")
    elif ctx.year:
        lines.append(f"- Año: {ctx.year}")
    if ctx.genres:
        lines.append(f"- Géneros: {', '.join(ctx.genres)}")
    if ctx.tags:
        lines.append(f"- Etiquetas emocionales / mood: {', '.join(ctx.tags[:6])}")
    if ctx.top_artists:
        lines.append(f"- Artistas que más escucha últimamente: {', '.join(ctx.top_artists[:5])}")
    lines.append(
        "- Usa el mood y la estética de la canción como una capa más de "
        "inspiración para el outfit; que se sienta coherente sin ser literal."
    )
    return "\n".join(lines)
