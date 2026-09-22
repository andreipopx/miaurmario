"""One music-source resolver per user: Spotify if connected, else Last.fm, else none.

Everything that needs "the user's music" goes through here so the Música tab,
the Stylist's SongContext, Stinky's chat tool and the "lo que suena ahora" chip
behave identically whatever the source:

- now playing: Spotify wins; Last.fm's scrobbler "now playing" is the fallback
  (also when Spotify is idle but the user is scrobbling from another player).
- mood context (no song typed): the primary source with ``use_for_mood`` on,
  then the other one.
- history: both sources sync into ``listening_events``; cross-source duplicate
  plays are dropped on insert (``listening_dedupe``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lastfm import LastfmConnection
from app.models.music import ListeningEvent, ListeningMood
from app.models.preference import UserPreference
from app.models.spotify import SpotifyConnection
from app.services.music_service import SongContext

logger = logging.getLogger(__name__)

Source = Literal["spotify", "lastfm"]


@dataclass
class MusicSources:
    spotify: SpotifyConnection | None = None
    lastfm: LastfmConnection | None = None

    @property
    def primary(self) -> Source | None:
        if self.spotify is not None:
            return "spotify"
        if self.lastfm is not None:
            return "lastfm"
        return None

    @property
    def connected(self) -> bool:
        return self.primary is not None

    @property
    def use_for_mood(self) -> bool:
        return bool(
            (self.spotify is not None and self.spotify.use_for_mood)
            or (self.lastfm is not None and self.lastfm.use_for_mood)
        )

    @property
    def last_synced_at(self) -> datetime | None:
        stamps = [
            s
            for s in (
                self.spotify.last_history_sync_at if self.spotify else None,
                self.lastfm.last_sync_at if self.lastfm else None,
            )
            if s is not None
        ]
        return max(stamps) if stamps else None


async def get_lastfm_connection(db: AsyncSession, user_id: Any) -> LastfmConnection | None:
    return (
        await db.execute(select(LastfmConnection).where(LastfmConnection.user_id == user_id))
    ).scalar_one_or_none()


async def get_sources(db: AsyncSession, user_id: Any) -> MusicSources:
    spotify = (
        await db.execute(select(SpotifyConnection).where(SpotifyConnection.user_id == user_id))
    ).scalar_one_or_none()
    return MusicSources(spotify=spotify, lastfm=await get_lastfm_connection(db, user_id))


async def now_playing(db: AsyncSession, sources: MusicSources) -> dict[str, Any] | None:
    """What is playing right now, tagged with its ``source``. Never raises."""
    from app.services import lastfm_history
    from app.services import music_overview as mo

    if sources.spotify is not None:
        try:
            track = await mo.now_playing(db, sources.spotify)
        except Exception:
            logger.debug("Spotify now playing failed", exc_info=True)
            track = None
        if track:
            return {**track, "source": "spotify"}
    if sources.lastfm is not None:
        track = await lastfm_history.now_playing(sources.lastfm)
        if track:
            return {**track, "source": "lastfm"}
    return None


async def listening_mood(db: AsyncSession, sources: MusicSources) -> SongContext | None:
    """Mood context from live listening (primary source first). Never raises."""
    from app.services import lastfm_history, spotify_mood

    order: list[Source] = ["spotify", "lastfm"]
    for source in order:
        try:
            if source == "spotify" and sources.spotify and sources.spotify.use_for_mood:
                ctx = await spotify_mood.listening_mood(db, sources.spotify)
            elif source == "lastfm" and sources.lastfm and sources.lastfm.use_for_mood:
                ctx = await lastfm_history.listening_mood(db, sources.lastfm)
            else:
                continue
        except Exception:
            logger.info("%s listening mood failed", source, exc_info=True)
            continue
        if ctx is not None:
            return ctx
    return None


# --- day mood + contrast flag ---------------------------------------------------------------


async def contrast_enabled(db: AsyncSession, user_id: Any) -> bool:
    value = (
        await db.execute(
            select(UserPreference.music_contrast).where(UserPreference.user_id == user_id)
        )
    ).scalar_one_or_none()
    return bool(value)


async def todays_music(db: AsyncSession, user: Any) -> ListeningMood | None:
    """Mood row of today (user's zone), else yesterday's if nothing played yet today."""
    from app.services.listening_mood import user_zone

    today = datetime.now(user_zone(getattr(user, "timezone", None))).date()
    return (
        await db.execute(
            select(ListeningMood)
            .where(
                ListeningMood.user_id == user.id,
                ListeningMood.day >= today - timedelta(days=1),
                ListeningMood.day <= today,
            )
            .order_by(ListeningMood.day.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def attach_day_mood(db: AsyncSession, user: Any, ctx: SongContext) -> SongContext:
    """Add today's music mood + the user's contrast preference to a SongContext."""
    from app.services.listening_mood import mood_sounds

    try:
        row = await todays_music(db, user)
        if row is not None and row.moods:
            ctx.day_sounds = [mood_sounds(m) for m in row.moods][:2]
            ctx.day_energy = round(float(row.energy), 2)
            ctx.day_valence = round(float(row.valence), 2)
        ctx.contrast = await contrast_enabled(db, user.id)
    except Exception:
        logger.debug("Day mood lookup failed", exc_info=True)
    return ctx


# --- privacy --------------------------------------------------------------------------------


RECOMPUTE_AFTER_PARTIAL_DELETE_DAYS = 30


async def delete_history(
    db: AsyncSession,
    user_id: Any,
    source: Source | None = None,
    tz_name: str | None = None,
) -> dict[str, int]:
    """Delete listening events (all, or one source's) + every mood row. Commits.

    Moods are derived data: when only one source is removed, the last 30 days
    of the remaining plays are recomputed now and older days lazily by the
    Música tab (``mood_timeline`` self-heals). Sync cursors are kept so the
    deleted plays are not re-imported by the next sync.
    """
    from app.services.listening_mood import local_day, recompute_days, user_zone

    stmt = delete(ListeningEvent).where(ListeningEvent.user_id == user_id)
    if source is not None:
        stmt = stmt.where(ListeningEvent.source == source)
    events = (await db.execute(stmt)).rowcount or 0
    moods = (
        await db.execute(delete(ListeningMood).where(ListeningMood.user_id == user_id))
    ).rowcount or 0
    if source is not None:
        zone = user_zone(tz_name)
        since = datetime.now(zone) - timedelta(days=RECOMPUTE_AFTER_PARTIAL_DELETE_DAYS)
        remaining = (
            (
                await db.execute(
                    select(ListeningEvent.played_at).where(
                        ListeningEvent.user_id == user_id, ListeningEvent.played_at >= since
                    )
                )
            )
            .scalars()
            .all()
        )
        days = {local_day(ts, zone) for ts in remaining}
        if days:
            await recompute_days(db, user_id, zone, days)
    await db.commit()
    await clear_caches(user_id)
    return {"events": int(events), "moods": int(moods)}


async def clear_caches(user_id: Any) -> None:
    from app.services import lastfm_history, spotify_mood
    from app.services.music_overview import clear_user_cache

    await clear_user_cache(user_id)
    await lastfm_history.clear_cache(user_id)
    await spotify_mood.clear_mood_cache(user_id)
