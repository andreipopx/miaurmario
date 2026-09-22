"""Daily listening mood: a deterministic genre/title → mood heuristic.

Spotify no longer exposes audio features (valence/energy) to new apps, and
artist genres are frequently empty, so the mood of a day is *estimated* from:

1. the primary artist's genres (keyword table below → energy/valence + votes),
2. keywords in track titles / album names (Spanish + English),
3. release year (older music nudges towards "nostálgico").

Everything here is pure and deterministic so it works without any AI. When the
user has AI access, ``refine_moods_with_ai`` optionally rewrites the labels and
one-liner of *finished* days with one small batched LLM call per user per day
(cached: an AI-refined day is never re-sent unless its plays change).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.music import ListeningEvent, ListeningMood

logger = logging.getLogger(__name__)


# --- Mood vocabulary ------------------------------------------------------------


@dataclass(frozen=True)
class MoodDef:
    key: str  # stable ASCII key (frontend i18n + colours)
    label: str  # Spanish label stored in the DB
    energy: float
    valence: float
    color: str  # pop palette: amber | pink | sky | mint
    sounds: str = ""  # "tu música suena …" (feminine, agrees with "música")


# Labels describe how the MUSIC sounds, never the listener.
MOODS: tuple[MoodDef, ...] = (
    MoodDef("euphoric", "eufórico", 0.85, 0.85, "amber", "eufórica"),
    MoodDef("electric", "eléctrico", 0.9, 0.55, "pink", "eléctrica"),
    MoodDef("intense", "intenso", 0.88, 0.22, "pink", "intensa"),
    MoodDef("romantic", "romántico", 0.45, 0.75, "pink", "romántica"),
    MoodDef("calm", "calmado", 0.22, 0.6, "mint", "tranquila"),
    MoodDef("dreamy", "soñador", 0.35, 0.5, "sky", "soñadora"),
    MoodDef("nostalgic", "nostálgico", 0.45, 0.42, "sky", "nostálgica"),
    MoodDef("melancholic", "melancólico", 0.3, 0.18, "sky", "melancólica"),
)
ECLECTIC = MoodDef("eclectic", "ecléctico", 0.5, 0.5, "amber", "ecléctica")
MOODS_BY_KEY: dict[str, MoodDef] = {m.key: m for m in (*MOODS, ECLECTIC)}
MOODS_BY_LABEL: dict[str, MoodDef] = {m.label: m for m in (*MOODS, ECLECTIC)}
ALLOWED_LABELS: tuple[str, ...] = tuple(m.label for m in (*MOODS, ECLECTIC))


def mood_key(label: str | None) -> str:
    mood = MOODS_BY_LABEL.get((label or "").strip().lower())
    return mood.key if mood else ECLECTIC.key


def mood_sounds(label: str | None) -> str:
    """Feminine form for "tu música suena …" copy."""
    mood = MOODS_BY_LABEL.get((label or "").strip().lower())
    return (mood or ECLECTIC).sounds


def mood_color(label: str | None) -> str:
    mood = MOODS_BY_LABEL.get((label or "").strip().lower())
    return mood.color if mood else ECLECTIC.color


# --- Heuristic tables -------------------------------------------------------------
# Order matters: the first rule whose keyword is a substring of a genre wins, so
# specific genres ("dancehall", "neo soul", "classic rock") come before broad
# ones ("dance", "soul", "rock").


@dataclass(frozen=True)
class GenreRule:
    keywords: tuple[str, ...]
    energy: float
    valence: float
    moods: tuple[str, ...]


GENRE_RULES: tuple[GenreRule, ...] = (
    GenreRule(
        ("reggaeton", "reggaetón", "urbano latino", "trap latino", "dembow", "perreo"),
        0.85,
        0.75,
        ("euphoric", "electric"),
    ),
    GenreRule(
        (
            "dancehall",
            "salsa",
            "bachata",
            "merengue",
            "cumbia",
            "samba",
            "afrobeat",
            "afropop",
            "funk",
            "disco",
            "k-pop",
            "j-pop",
            "latin pop",
        ),
        0.8,
        0.85,
        ("euphoric",),
    ),
    GenreRule(("emo", "sadcore", "slowcore", "sad "), 0.35, 0.15, ("melancholic",)),
    GenreRule(("blues",), 0.4, 0.3, ("melancholic", "nostalgic")),
    GenreRule(
        ("metal", "hardcore", "punk", "grunge", "screamo", "industrial", "drill", "phonk"),
        0.92,
        0.25,
        ("intense",),
    ),
    GenreRule(
        (
            "edm",
            "house",
            "techno",
            "trance",
            "electro",
            "dance",
            "drum and bass",
            "dnb",
            "dubstep",
            "hardstyle",
            "rave",
            "club",
            "hyperpop",
        ),
        0.9,
        0.62,
        ("electric", "euphoric"),
    ),
    GenreRule(("hip hop", "hip-hop", "rap", "trap", "grime"), 0.75, 0.48, ("intense", "electric")),
    GenreRule(
        ("ambient", "lo-fi", "lofi", "chill", "new age", "meditation", "sleep", "downtempo"),
        0.2,
        0.55,
        ("calm", "dreamy"),
    ),
    GenreRule(
        ("classical", "piano", "orchestra", "baroque", "opera", "soundtrack", "score"),
        0.3,
        0.5,
        ("calm", "dreamy"),
    ),
    GenreRule(
        ("shoegaze", "dream pop", "dreampop", "ethereal", "bedroom pop", "slowed"),
        0.4,
        0.45,
        ("dreamy",),
    ),
    GenreRule(("r&b", "rnb", "neo soul", "neo-soul"), 0.45, 0.65, ("romantic",)),
    GenreRule(("bolero", "balada", "ballad", "romantic", "romántic"), 0.35, 0.6, ("romantic",)),
    GenreRule(("jazz", "bossa", "soul", "lounge"), 0.4, 0.6, ("calm", "romantic")),
    GenreRule(
        (
            "oldies",
            "60s",
            "70s",
            "80s",
            "90s",
            "retro",
            "vintage",
            "classic ",
            "yacht",
            "city pop",
            "synthwave",
            "new wave",
            "flamenco",
            "copla",
            "rumba",
        ),
        0.55,
        0.55,
        ("nostalgic",),
    ),
    GenreRule(
        ("folk", "acoustic", "singer-songwriter", "cantautor", "americana", "country"),
        0.35,
        0.5,
        ("nostalgic", "calm"),
    ),
    GenreRule(("indie", "alternative", "alt "), 0.6, 0.45, ("dreamy", "nostalgic")),
    GenreRule(("rock",), 0.75, 0.5, ("electric", "intense")),
    GenreRule(("pop",), 0.65, 0.7, ("euphoric", "romantic")),
)


@dataclass(frozen=True)
class TitleRule:
    keywords: tuple[str, ...]
    d_energy: float
    d_valence: float
    mood: str


TITLE_RULES: tuple[TitleRule, ...] = (
    TitleRule(
        (
            "sad",
            "triste",
            "lonely",
            "soledad",
            "cry",
            "llor",
            "lágrima",
            "tears",
            "goodbye",
            "adiós",
            "adios",
            "miss you",
            "te extraño",
            "broken",
            "dolor",
            "pain",
            "alone",
        ),
        -0.05,
        -0.2,
        "melancholic",
    ),
    TitleRule(
        ("love", "amor", "corazón", "corazon", "heart", "kiss", "beso", "cariño", "te quiero"),
        0.0,
        0.1,
        "romantic",
    ),
    TitleRule(
        (
            "dream",
            "sueño",
            "sueno",
            "moon",
            "luna",
            "stars",
            "estrellas",
            "cielo",
            "night",
            "noche",
        ),
        -0.05,
        0.0,
        "dreamy",
    ),
    TitleRule(
        ("party", "fiesta", "dance", "baila", "perreo", "club", "remix", "gasolina", "tonight"),
        0.15,
        0.1,
        "euphoric",
    ),
    TitleRule(
        ("acoustic", "acústic", "piano", "lullaby", "rain", "lluvia", "slow", "calm", "calma"),
        -0.15,
        0.0,
        "calm",
    ),
    TitleRule(
        ("remaster", "memories", "recuerdo", "nostalg", "yesterday", "ayer", "old times"),
        0.0,
        -0.05,
        "nostalgic",
    ),
    TitleRule(
        ("fire", "fuego", "rage", "war", "guerra", "kill", "demon", "hell", "infierno", "rebel"),
        0.12,
        -0.1,
        "intense",
    ),
    TitleRule(
        ("electric", "eléctric", "voltage", "power", "energy", "energía"), 0.12, 0.05, "electric"
    ),
)

_WORD_BOUNDARY_CACHE: dict[str, re.Pattern[str]] = {}


def _kw_pattern(keyword: str) -> re.Pattern[str]:
    pat = _WORD_BOUNDARY_CACHE.get(keyword)
    if pat is None:
        # Keywords must start a word; stems ("llor", "nostalg") still match
        # longer words ("lloro", "nostalgia").
        pat = re.compile(r"(?<![\w])" + re.escape(keyword), re.IGNORECASE)
        _WORD_BOUNDARY_CACHE[keyword] = pat
    return pat


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


# --- Per-play signal ----------------------------------------------------------------


@dataclass
class PlaySignal:
    energy: float | None = None
    valence: float | None = None
    votes: Counter[str] = field(default_factory=Counter)

    @property
    def has_signal(self) -> bool:
        return self.energy is not None


def match_genre(genre: str) -> GenreRule | None:
    g = f" {genre.strip().lower()} "
    for rule in GENRE_RULES:
        for kw in rule.keywords:
            if kw in g:
                return rule
    return None


def play_signal(
    genres: Iterable[str],
    title: str | None,
    album: str | None = None,
    release_year: int | None = None,
) -> PlaySignal:
    """Estimate energy/valence and mood votes for one play."""
    sig = PlaySignal()
    energies: list[float] = []
    valences: list[float] = []
    for genre in genres or []:
        if not isinstance(genre, str):
            continue
        rule = match_genre(genre)
        if rule is None:
            continue
        energies.append(rule.energy)
        valences.append(rule.valence)
        for i, key in enumerate(rule.moods):
            sig.votes[key] += 1.0 if i == 0 else 0.5

    d_energy = 0.0
    d_valence = 0.0
    title_hit = False
    text = " ".join(p for p in (title, album) if p)
    if text:
        for trule in TITLE_RULES:
            if any(_kw_pattern(kw).search(text) for kw in trule.keywords):
                title_hit = True
                d_energy += trule.d_energy
                d_valence += trule.d_valence
                sig.votes[trule.mood] += 0.75

    year_hit = False
    if release_year and release_year < 2000:
        year_hit = True
        sig.votes["nostalgic"] += 0.75 if release_year >= 1985 else 1.25

    if energies:
        sig.energy = _clamp(sum(energies) / len(energies) + d_energy)
        sig.valence = _clamp(sum(valences) / len(valences) + d_valence)
    elif title_hit or year_hit:
        sig.energy = _clamp(0.5 + d_energy)
        sig.valence = _clamp(0.5 + d_valence)
    return sig


# --- Day aggregate ------------------------------------------------------------------


@dataclass
class DayMood:
    moods: list[str]
    energy: float
    valence: float
    top_genres: list[str]
    genre_counts: dict[str, int]
    track_count: int
    listened_ms: int
    dominant_artists: list[str]
    one_liner: str
    signature: str

    @property
    def primary(self) -> MoodDef:
        return MOODS_BY_LABEL.get(self.moods[0], ECLECTIC) if self.moods else ECLECTIC


# Last.fm scrobbles carry no duration: count an average-length track.
DEFAULT_PLAY_MS = 210_000

# Product rule: the mood only exists to dress the person. Copy describes how
# the MUSIC sounds and what that asks for in clothes ("Tu música de hoy suena
# melancólica"), never the listener's state of mind.
ONE_LINERS: dict[str, tuple[str, str]] = {
    "euphoric": (
        "Tu música de hoy suena a subidón con {artist}: Stinky pide color y algo que brille.",
        "Tu música de hoy suena eufórica: esto pide color y algo que brille.",
    ),
    "electric": (
        "{artist} pone tu música en alto voltaje: contraste, actitud y bigotes de punta.",
        "Tu música de hoy suena eléctrica: contraste, actitud y bigotes de punta.",
    ),
    "intense": (
        "Música intensa con {artist}: Stinky propone negro, botas y paso firme.",
        "Tu música de hoy suena intensa: capas oscuras y paso firme.",
    ),
    "romantic": (
        "Música romántica con {artist}: tejidos suaves y tonos cálidos, aprobado con ronroneo.",
        "Tu música de hoy suena romántica: tejidos suaves y tonos cálidos.",
    ),
    "calm": (
        "Música en calma con {artist}: punto cómodo y tonos neutros, modo ovillo.",
        "Tu música de hoy suena tranquila: comodidad y tonos neutros.",
    ),
    "dreamy": (
        "Música soñadora con {artist}: texturas ligeras y un pastel que flote.",
        "Tu música de hoy suena soñadora: texturas ligeras y colores pastel.",
    ),
    "nostalgic": (
        "{artist} le da a tu música un aire retro: Stinky rebusca un básico vintage.",
        "Tu música de hoy suena nostálgica: un básico vintage nunca falla.",
    ),
    "melancholic": (
        "Tu música de hoy suena melancólica con {artist}: capas suaves y un jersey que abrace.",
        "Tu música de hoy suena melancólica: capas suaves y punto gordito.",
    ),
    "eclectic": (
        "Un poco de todo con {artist}: tu música de hoy pide combinar sin miedo.",
        "Tu música de hoy suena ecléctica: combina sin miedo.",
    ),
}

# Phrases that talk about the listener instead of the music. AI-written
# one-liners matching any of these are discarded (the heuristic line is kept).
PERSON_MOOD_RE = re.compile(
    r"\b(est[áa]s|estar[áa]s|te sientes|sientes|te notas|te veo|pareces|"
    r"triste|tristes|tristeza|deprimid\w*|depre|baj[óo]n|[áa]nimo|an[íi]mate|animarte|"
    r"you(?:'re| are) (?:sad|down|feeling)|you feel|feeling (?:sad|down|blue))\b",
    re.IGNORECASE,
)


def talks_about_person(text: str | None) -> bool:
    return bool(text and PERSON_MOOD_RE.search(text))


# A low-sounding day: the only case where the optional "contrast" look applies.
LOW_VALENCE = 0.4
LOW_ENERGY = 0.35


def is_low_mood(energy: float | None, valence: float | None) -> bool:
    if energy is None or valence is None:
        return False
    return valence < LOW_VALENCE or (energy < LOW_ENERGY and valence < 0.55)


def one_liner_for(key: str, artist: str | None) -> str:
    with_artist, plain = ONE_LINERS.get(key, ONE_LINERS["eclectic"])
    return (with_artist.format(artist=artist) if artist else plain)[:280]


def plays_signature(plays: Sequence[Any]) -> str:
    parts = sorted(f"{p.track_id}|{p.played_at.isoformat()}" for p in plays)
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def score_moods(energy: float, valence: float, votes: Counter[str]) -> list[tuple[MoodDef, float]]:
    total_votes = sum(votes.values())
    scored: list[tuple[MoodDef, float]] = []
    for mood in MOODS:
        dist = math.hypot(energy - mood.energy, valence - mood.valence)
        proximity = 1.0 - dist / math.sqrt(2)
        share = votes.get(mood.key, 0.0) / total_votes if total_votes else 0.0
        scored.append((mood, 0.55 * share + 0.45 * proximity))
    # Stable: ties keep the MOODS order.
    scored.sort(key=lambda s: -s[1])
    return scored


def compute_day_mood(plays: Sequence[Any]) -> DayMood:
    """Aggregate a day's plays (ListeningEvent-like objects) into a DayMood."""
    energies: list[float] = []
    valences: list[float] = []
    votes: Counter[str] = Counter()
    genre_counts: Counter[str] = Counter()
    artist_counts: Counter[str] = Counter()
    listened_ms = 0

    for play in plays:
        genres = [g for g in (play.genres or []) if isinstance(g, str) and g.strip()]
        for g in genres:
            genre_counts[g.strip().lower()] += 1
        if play.artist_name:
            artist_counts[play.artist_name] += 1
        listened_ms += int(play.duration_ms or DEFAULT_PLAY_MS)
        sig = play_signal(genres, play.track_name, play.album, play.release_year)
        votes.update(sig.votes)
        if sig.has_signal:
            energies.append(sig.energy)  # type: ignore[arg-type]
            valences.append(sig.valence)  # type: ignore[arg-type]

    # Counter.most_common keeps insertion order for ties -> deterministic.
    dominant = [a for a, _ in artist_counts.most_common(3)]
    top_genres = [g for g, _ in sorted(genre_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:5]]

    if energies:
        energy = round(sum(energies) / len(energies), 3)
        valence = round(sum(valences) / len(valences), 3)
        scored = score_moods(energy, valence, votes)
        top_mood, top_score = scored[0]
        labels = [top_mood.label]
        second, second_score = scored[1]
        if second_score >= 0.85 * top_score and votes.get(second.key, 0) > 0:
            labels.append(second.label)
    else:
        energy, valence = 0.5, 0.5
        labels = [ECLECTIC.label]

    key = mood_key(labels[0])
    return DayMood(
        moods=labels,
        energy=energy,
        valence=valence,
        top_genres=top_genres,
        genre_counts=dict(genre_counts),
        track_count=len(plays),
        listened_ms=listened_ms,
        dominant_artists=dominant,
        one_liner=one_liner_for(key, dominant[0] if dominant else None),
        signature=plays_signature(plays),
    )


# --- Persistence -----------------------------------------------------------------------


def user_zone(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_day_bounds(day: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return start, end


def local_day(ts: datetime, zone: ZoneInfo) -> date:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(zone).date()


async def recompute_days(
    db: AsyncSession, user_id: uuid.UUID, zone: ZoneInfo, days: Iterable[date]
) -> list[ListeningMood]:
    """(Re)compute the mood row of each local day. Unchanged plays are a no-op.

    Does not commit.
    """
    out: list[ListeningMood] = []
    for day in sorted(set(days)):
        start, end = local_day_bounds(day, zone)
        plays = (
            (
                await db.execute(
                    select(ListeningEvent)
                    .where(
                        ListeningEvent.user_id == user_id,
                        ListeningEvent.played_at >= start,
                        ListeningEvent.played_at < end,
                    )
                    .order_by(ListeningEvent.played_at)
                )
            )
            .scalars()
            .all()
        )
        row = (
            await db.execute(
                select(ListeningMood).where(
                    ListeningMood.user_id == user_id, ListeningMood.day == day
                )
            )
        ).scalar_one_or_none()
        if not plays:
            if row is not None:
                await db.delete(row)
            continue
        mood = compute_day_mood(plays)
        if row is not None and row.signature == mood.signature:
            out.append(row)
            continue
        if row is None:
            row = ListeningMood(user_id=user_id, day=day)
            db.add(row)
        row.moods = mood.moods
        row.energy = mood.energy
        row.valence = mood.valence
        row.top_genres = mood.top_genres
        row.genre_counts = mood.genre_counts
        row.track_count = mood.track_count
        row.listened_ms = mood.listened_ms
        row.dominant_artists = mood.dominant_artists
        row.one_liner = mood.one_liner
        row.method = "heuristic"
        row.signature = mood.signature
        row.computed_at = datetime.now(UTC)
        out.append(row)
    await db.flush()
    return out


# --- Optional AI refinement ---------------------------------------------------------------

AI_REFINE_MAX_DAYS = 7
AI_REFINE_MIN_TRACKS = 3
AI_REFINE_THROTTLE_PREFIX = "music:mood:ai"

AI_SYSTEM_PROMPT = (
    "Eres Stinky, el gato estilista de Miaurmario. Describes cómo SUENA la música de un "
    "día (su energía y su color) para inspirar la ropa. Hablas de la música, nunca de la "
    "persona: no supones cómo se siente ni le atribuyes emociones. Respondes SOLO con "
    "JSON válido."
)


def _build_ai_prompt(rows: Sequence[ListeningMood], tracks: dict[date, list[str]]) -> str:
    days = []
    for row in rows:
        days.append(
            {
                "date": row.day.isoformat(),
                "tracks": tracks.get(row.day, [])[:12],
                "genres": list(row.top_genres or [])[:5],
                "artists": list(row.dominant_artists or [])[:3],
                "heuristic_moods": list(row.moods or []),
            }
        )
    return (
        "Para cada día, elige 1 o 2 moods SOLO de esta lista: "
        f"{', '.join(ALLOWED_LABELS)} (describen la MÚSICA). Estima energy y valence de la "
        "música entre 0 y 1, y escribe un one_liner corto (máx. 120 caracteres, en español, "
        "tono juguetón de gato) sobre cómo suena la música y qué ropa pide, p. ej. "
        "«Tu música de hoy suena melancólica: capas suaves y un jersey que abrace». Puede "
        "mencionar a un artista. Habla solo de la música y la ropa, nunca de la persona.\n"
        'Formato: {"days": [{"date": "YYYY-MM-DD", "moods": ["..."], "energy": 0.5, '
        '"valence": 0.5, "one_liner": "..."}]}\n\n'
        f"Días:\n{json.dumps(days, ensure_ascii=False)}"
    )


def parse_ai_refinement(text: str) -> dict[str, dict[str, Any]]:
    """Validate the LLM answer; unknown labels / malformed entries are dropped."""
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except (ValueError, TypeError):
        return {}
    out: dict[str, dict[str, Any]] = {}
    entries = data.get("days") if isinstance(data, dict) else None
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        day = str(entry.get("date") or "")
        labels = [
            str(m).strip().lower()
            for m in entry.get("moods") or []
            if isinstance(m, str) and str(m).strip().lower() in MOODS_BY_LABEL
        ][:2]
        if not day or not labels:
            continue
        try:
            energy = _clamp(float(entry.get("energy")))
            valence = _clamp(float(entry.get("valence")))
        except (TypeError, ValueError):
            continue
        one_liner = str(entry.get("one_liner") or "").strip()[:160] or None
        if talks_about_person(one_liner):
            one_liner = None
        out[day] = {
            "moods": list(dict.fromkeys(labels)),
            "energy": round(energy, 3),
            "valence": round(valence, 3),
            "one_liner": one_liner,
        }
    return out


async def refine_moods_with_ai(db: AsyncSession, user: Any, zone: ZoneInfo) -> int:
    """Refine finished days with one batched LLM call (max once per user per day).

    Returns the number of refined days. Never raises; without AI access it is a no-op.
    """
    from app.config import get_settings
    from app.services.ai_access import resolve_ai_client

    if not getattr(get_settings(), "music_mood_ai_enabled", True):
        return 0
    today = datetime.now(zone).date()
    rows = (
        (
            await db.execute(
                select(ListeningMood)
                .where(
                    ListeningMood.user_id == user.id,
                    ListeningMood.method == "heuristic",
                    ListeningMood.day < today,
                    ListeningMood.track_count >= AI_REFINE_MIN_TRACKS,
                )
                .order_by(ListeningMood.day.desc())
                .limit(AI_REFINE_MAX_DAYS)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0

    throttle_key = f"{AI_REFINE_THROTTLE_PREFIX}:{user.id}:{today.isoformat()}"
    try:
        from app.utils.redis_lock import get_redis

        redis = await get_redis()
        if not await redis.set(throttle_key, "1", ex=60 * 60 * 26, nx=True):
            return 0
    except Exception:
        logger.debug("AI mood refine throttle unavailable; skipping", exc_info=True)
        return 0

    ai = await resolve_ai_client(db, user, "text")
    if ai is None:
        return 0

    tracks: dict[date, list[str]] = {}
    for row in rows:
        start, end = local_day_bounds(row.day, zone)
        plays = (
            await db.execute(
                select(ListeningEvent.artist_name, ListeningEvent.track_name)
                .where(
                    ListeningEvent.user_id == user.id,
                    ListeningEvent.played_at >= start,
                    ListeningEvent.played_at < end,
                )
                .order_by(ListeningEvent.played_at)
                .limit(40)
            )
        ).all()
        seen: list[str] = []
        for artist, name in plays:
            label = f"{artist} — {name}" if artist else name
            if label not in seen:
                seen.append(label)
        tracks[row.day] = seen

    try:
        answer = await ai.generate_text(_build_ai_prompt(rows, tracks), AI_SYSTEM_PROMPT)
    except Exception as exc:
        logger.info("AI mood refinement failed for user %s: %s", user.id, exc)
        return 0
    parsed = parse_ai_refinement(answer if isinstance(answer, str) else answer.content)
    refined = 0
    for row in rows:
        entry = parsed.get(row.day.isoformat())
        if not entry:
            continue
        row.moods = entry["moods"]
        row.energy = entry["energy"]
        row.valence = entry["valence"]
        if entry["one_liner"]:
            row.one_liner = entry["one_liner"]
        row.method = "ai"
        row.computed_at = datetime.now(UTC)
        refined += 1
    await db.flush()
    return refined
