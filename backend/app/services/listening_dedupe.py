"""Merge listening history from several sources without duplicate plays.

Spotify users can also scrobble to Last.fm, so the same play may arrive twice:
once from Spotify's recently-played (``played_at`` = when the track *ended*)
and once from Last.fm (``uts`` = when it *started*). Rows from different
sources never collide on the (user, track_id, played_at) unique key, so plays
are matched here on a normalised "artist | title" key within a time window,
one-to-one (two back-to-back plays of the same song stay two plays).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.music import ListeningEvent

MATCH_WINDOW = timedelta(minutes=12)

# "Song - Remastered 2011", "Song (feat. X)", "Song [Live]"...
_SUFFIX_RE = re.compile(
    r"\s+[-–—]\s+(?:.*remaster.*|.*version.*|.*live.*|.*edit.*|.*mix.*|.*mono.*|.*stereo.*)$",
    re.IGNORECASE,
)
_BRACKETS_RE = re.compile(r"\s*[\(\[].*?[\)\]]")
_NON_WORD_RE = re.compile(r"[^\w]+")


def _fold(text: str | None) -> str:
    text = unicodedata.normalize("NFKD", (text or "").casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return _NON_WORD_RE.sub(" ", text).strip()


def normalise_title(title: str | None) -> str:
    t = _SUFFIX_RE.sub("", title or "")
    t = _BRACKETS_RE.sub("", t)
    return _fold(t) or _fold(title)


def play_key(artist: str | None, title: str | None) -> str:
    return f"{_fold(artist)}|{normalise_title(title)}"


def track_key_id(artist: str | None, title: str | None, prefix: str = "lfm") -> str:
    """Stable track id for sources without one (fits String(64))."""
    digest = hashlib.sha1(play_key(artist, title).encode()).hexdigest()  # noqa: S324
    return f"{prefix}:{digest[:40]}"


async def drop_cross_source_duplicates(
    db: AsyncSession, user_id: Any, plays: list[dict[str, Any]], source: str
) -> list[dict[str, Any]]:
    """Remove incoming plays already stored from *another* source."""
    if not plays:
        return plays
    since = min(p["played_at"] for p in plays) - MATCH_WINDOW
    until = max(p["played_at"] for p in plays) + MATCH_WINDOW
    rows = (
        await db.execute(
            select(ListeningEvent.artist_name, ListeningEvent.track_name, ListeningEvent.played_at)
            .where(
                ListeningEvent.user_id == user_id,
                ListeningEvent.source != source,
                ListeningEvent.played_at >= since,
                ListeningEvent.played_at <= until,
            )
            .order_by(ListeningEvent.played_at)
        )
    ).all()
    if not rows:
        return plays
    existing: dict[str, list[Any]] = defaultdict(list)
    for artist, title, played_at in rows:
        existing[play_key(artist, title)].append(played_at)

    kept: list[dict[str, Any]] = []
    for play in sorted(plays, key=lambda p: p["played_at"]):
        candidates = existing.get(play_key(play.get("artist_name"), play.get("track_name")))
        match = None
        if candidates:
            best = min(candidates, key=lambda ts: abs(ts - play["played_at"]))
            if abs(best - play["played_at"]) <= MATCH_WINDOW:
                match = best
        if match is not None:
            candidates.remove(match)  # one-to-one
            continue
        kept.append(play)
    return kept
