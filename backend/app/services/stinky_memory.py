"""«Stinky recuerda»: writing, reading and rendering the per-user memory.

Stinky keeps a small notebook about each person, the way a coding agent keeps a
CLAUDE.md: short, human-readable lines he writes himself while they chat. This
module is the only place that writes it, so every guard lives here:

* **Scope** — a memory always belongs to exactly one ``user_id``; nothing is
  ever read or written across users, and nothing is shared with friends/family.
* **What may be stored** — stable, useful-for-dressing things. Anything that
  looks like health, body/weight, religion, sexuality, politics, money trouble
  or a credential is refused (:class:`SensitiveMemory`), and the caller turns
  that into an explanation the model sees.
* **Size** — one note is capped at 200 characters, a user at 60 notes
  (oldest unpinned, least recently used evicted first), and the digest injected
  into prompts at ~800 characters.
* **Dedupe** — a new note that says nearly the same thing as an existing one of
  the same kind updates it instead of piling up.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stinky_memory import (
    MAX_MEMORIES_PER_USER,
    MAX_MEMORY_TEXT_CHARS,
    MEMORY_KIND_NAME,
    MEMORY_KINDS,
    MEMORY_SOURCES,
    StinkyMemory,
)

logger = logging.getLogger(__name__)

#: Characters of digest injected into a prompt. Small on purpose: the memory is
#: a hint, not the brief.
MAX_DIGEST_CHARS = 800
#: Longest name Stinky will call someone.
MAX_CALL_NAME_CHARS = 40

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")
_WORD_RE = re.compile(r"[a-z0-9]+")


class MemoryRefused(Exception):
    """The note was not stored; ``reason`` is safe to show the model/user."""

    def __init__(self, reason: str, code: str = "refused"):
        super().__init__(reason)
        self.code = code


class SensitiveMemory(MemoryRefused):
    """The note looked like something Stinky must never write down."""

    def __init__(self, reason: str):
        super().__init__(reason, code="sensitive")


# --- What Stinky must never write down -------------------------------------------------
#
# Deliberately blunt and a little over-eager: refusing a note the person could
# just repeat costs nothing, storing a health or body fact costs a lot. Spanish
# first (the app is Spanish-first), English alongside.

_SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "health",
        re.compile(
            r"\b(enfermedad|enferma?o|diagnostic\w*|depresi\w+|ansiedad|c[áa]ncer|diabet\w+|"
            r"embaraz\w+|medicaci\w+|medicament\w+|tratamiento m[ée]dico|terapia|psic[óo]log\w+|"
            r"psiquiatr\w+|discapacidad|cr[óo]nic\w+|s[íi]ntoma\w*|hospital|cirug[íi]a|"
            r"illness|disease|diagnos\w+|depress\w+|anxiety|cancer|diabet\w+|pregnan\w+|"
            r"medication|therapy|disability|chronic|symptom\w*|surgery)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "body",
        re.compile(
            r"\b(peso|pesa|kilos?|kg|adelgaz\w+|engord\w+|dieta|sobrepeso|obes\w+|gordo?a?|"
            r"delgad\w+|flaco?a?|barriga|celulitis|complejo\w*|imc|"
            r"weight|weighs|pounds?|lbs|diet(ing)?|overweight|obes\w+|fat|skinny|"
            r"belly|body ?image|bmi)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "religion",
        re.compile(
            r"\b(religi\w+|cat[óo]lic\w+|crist[ií]an\w+|musulman\w+|isl[áa]m\w+|jud[íi]o?a?|"
            r"jud[ií]a|hind[úu]|budist\w+|ate[oa]s?|agn[óo]stic\w+|iglesia|misa|mezquita|"
            r"sinagoga|ramad[áa]n|kosher|halal|"
            r"religio\w+|catholic|christian|muslim|jewish|hindu|buddhist|atheist|agnostic|"
            r"church|mosque|synagogue|ramadan)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "sexuality",
        re.compile(
            r"\b(sexualidad|orientaci[óo]n sexual|gay|lesbian\w*|bisexual|homosexual|"
            r"heterosexual|trans(g[ée]nero)?|no binari\w+|queer|salir del armario|"
            r"sexuality|sexual orientation|nonbinary|non-binary|coming out)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "politics",
        re.compile(
            r"\b(pol[íi]tic\w+|vota\w*|partido (pol[íi]tico|de)|izquierdas?|derechas?|"
            r"comunist\w+|fascist\w+|feminist\w+|sindicat\w+|activist\w+|"
            r"politic\w+|votes?|voted|voting|left-?wing|right-?wing|communist|fascist|union member)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "money",
        re.compile(
            r"\b(sin dinero|no tiene dinero|no puede permitirse|no me llega|deuda\w*|"
            r"hipotec\w+|par[oa]d[oa]|en el paro|despedid\w+|sueldo|salario|n[óo]mina|"
            r"quiebra|pobreza|pr[ée]stamo|"
            r"broke|no money|can'?t afford|cannot afford|debts?|mortgage|unemployed|"
            r"laid off|fired|salary|wages?|bankrupt|poverty|loan)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "secret",
        re.compile(
            r"\b(contrase[ñn]a|password|passwd|clave de acceso|pin|api[_ -]?key|token|"
            r"secret|tarjeta de cr[ée]dito|credit card|iban|dni|nie|pasaporte|passport|"
            r"n[úu]mero de cuenta|account number|ssn)\b",
            re.IGNORECASE,
        ),
    ),
)

_SENSITIVE_REASON = (
    "No guardo nada sobre salud, cuerpo, peso, religión, sexualidad, política, dinero "
    "ni datos secretos. Sigue la conversación sin anotarlo."
)


def sensitive_category(text: str) -> str | None:
    """The first sensitive category ``text`` trips, or None."""
    for name, pattern in _SENSITIVE_PATTERNS:
        if pattern.search(text):
            return name
    return None


# --- Normalisation and near-duplicate detection -----------------------------------------


def clean_memory_text(value: Any, limit: int = MAX_MEMORY_TEXT_CHARS) -> str:
    """One line, no control characters, capped — what actually gets stored."""
    text = _CONTROL_RE.sub(" ", str(value or "")).strip()
    text = re.sub(r"\s{2,}", " ", text)
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _fold(text: str) -> str:
    """Lowercase, accent-free form used for comparisons only."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


# Words that carry no meaning for "are these two notes the same thing?".
_STOPWORDS = frozenset(
    """a al algo alguna algunas alguno algunos ante antes como con contra cual cuando de del
    desde donde dos el ella ellas ellos en entre era eres es esa esas ese eso esos esta estas
    este esto estos ha han hasta la las le les lo los mas me mi mis mucho muy no nos o os otra
    otras otro otros para pero poco por porque que se sea segun ser si sin sobre son su sus
    tambien tanto te tiene tu tus un una uno unos y ya
    a an and are as at be but by for from has have he her his in is it its of on or she that
    the their them they this to was were with you your""".split()
)


def _tokens(text: str) -> frozenset[str]:
    words = _WORD_RE.findall(_fold(text))
    # Numbers count however short they are: "talla 42" and "talla 44" are two
    # different facts, and collapsing them would silently lose one.
    meaningful = {w for w in words if w not in _STOPWORDS and (len(w) > 2 or w.isdigit())}
    return frozenset(meaningful or words)


def _numbers(text: str) -> frozenset[str]:
    return frozenset(w for w in _WORD_RE.findall(_fold(text)) if w.isdigit())


#: Jaccard overlap above which two notes of the same kind are "the same thing".
DEDUPE_THRESHOLD = 0.6


def similarity(a: str, b: str) -> float:
    """0..1 overlap of the meaningful words of two notes."""
    if _fold(a) == _fold(b):
        return 1.0
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _is_duplicate(a: str, b: str) -> bool:
    """Do these two notes say the same thing?

    Conservative by design: a wrongly merged note loses information the user
    told us, while a wrongly kept one is just one more line they can delete.
    """
    fa, fb = _fold(a), _fold(b)
    if fa == fb:
        return True
    # Different numbers (sizes, temperatures, days) = different facts.
    if _numbers(a) != _numbers(b):
        return False
    if fa in fb or fb in fa:
        return True
    ta, tb = _tokens(a), _tokens(b)
    # One note is a more detailed version of the other ("pantalón ancho" ->
    # "pantalón ancho de lino").
    if len(ta) >= 2 and len(tb) >= 2 and (ta <= tb or tb <= ta):
        return True
    return similarity(a, b) >= DEDUPE_THRESHOLD


# --- Reading -----------------------------------------------------------------------------


async def list_memories(db: AsyncSession, user_id: UUID) -> list[StinkyMemory]:
    """Every note of this user, newest first (pinned first)."""
    result = await db.execute(
        select(StinkyMemory)
        .where(StinkyMemory.user_id == user_id)
        .order_by(
            StinkyMemory.pinned.desc(),
            StinkyMemory.updated_at.desc(),
            StinkyMemory.created_at.desc(),
        )
    )
    return list(result.scalars().all())


async def get_memory(db: AsyncSession, user_id: UUID, memory_id: UUID) -> StinkyMemory | None:
    result = await db.execute(
        select(StinkyMemory).where(StinkyMemory.id == memory_id, StinkyMemory.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def count_memories(db: AsyncSession, user_id: UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(StinkyMemory).where(StinkyMemory.user_id == user_id)
    )
    return int(result.scalar_one())


async def get_call_name(db: AsyncSession, user_id: UUID) -> str | None:
    """The name the person asked Stinky to call them (not the account name)."""
    result = await db.execute(
        select(StinkyMemory.text).where(
            StinkyMemory.user_id == user_id, StinkyMemory.kind == MEMORY_KIND_NAME
        )
    )
    return result.scalars().first()


# --- Writing -----------------------------------------------------------------------------


async def _evict_if_needed(db: AsyncSession, user_id: UUID) -> int:
    """Keep at most ``MAX_MEMORIES_PER_USER`` notes; drop the stalest first.

    Pinned notes and the preferred name are never evicted.
    """
    total = await count_memories(db, user_id)
    excess = total - MAX_MEMORIES_PER_USER
    if excess <= 0:
        return 0
    result = await db.execute(
        select(StinkyMemory.id)
        .where(
            StinkyMemory.user_id == user_id,
            StinkyMemory.pinned.is_(False),
            StinkyMemory.kind != MEMORY_KIND_NAME,
        )
        # Oldest unpinned, least recently used first (never used sorts first).
        .order_by(
            StinkyMemory.last_used_at.asc().nullsfirst(),
            StinkyMemory.updated_at.asc(),
            StinkyMemory.created_at.asc(),
        )
        .limit(excess)
    )
    victims = list(result.scalars().all())
    if victims:
        await db.execute(delete(StinkyMemory).where(StinkyMemory.id.in_(victims)))
    return len(victims)


async def remember(
    db: AsyncSession,
    user_id: UUID,
    kind: str,
    text: str,
    *,
    source: str = "chat",
    pinned: bool | None = None,
    confidence: float = 0.8,
) -> tuple[StinkyMemory, str]:
    """Store one note. Returns ``(memory, "created" | "updated")``.

    Raises :class:`MemoryRefused` (or :class:`SensitiveMemory`) when the note is
    empty, too vague, of an unknown kind, or about something Stinky must not
    write down. The caller commits.
    """
    kind = (kind or "").strip().lower()
    if kind not in MEMORY_KINDS:
        raise MemoryRefused(
            "Unknown kind. Use one of: " + ", ".join(MEMORY_KINDS) + ".", code="bad_kind"
        )
    if source not in MEMORY_SOURCES:
        source = "chat"

    limit = MAX_CALL_NAME_CHARS if kind == MEMORY_KIND_NAME else MAX_MEMORY_TEXT_CHARS
    clean = clean_memory_text(text, limit)
    if len(clean) < 2:
        raise MemoryRefused("The note is empty.", code="empty")

    if sensitive_category(clean) is not None:
        raise SensitiveMemory(_SENSITIVE_REASON)

    now = datetime.now(UTC)

    # The preferred name is a singleton: a new one replaces the old one.
    if kind == MEMORY_KIND_NAME:
        existing = (
            (
                await db.execute(
                    select(StinkyMemory).where(
                        StinkyMemory.user_id == user_id, StinkyMemory.kind == MEMORY_KIND_NAME
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            action = "updated" if _fold(existing.text) != _fold(clean) else "unchanged"
            existing.text = clean
            existing.source = source
            existing.pinned = True
            existing.confidence = confidence
            existing.updated_at = now
            await db.flush()
            return existing, action
        memory = StinkyMemory(
            user_id=user_id,
            kind=kind,
            text=clean,
            source=source,
            confidence=confidence,
            pinned=True,
        )
        db.add(memory)
        await db.flush()
        return memory, "created"

    # Near-identical note of the same kind? Update it instead of piling up.
    same_kind = (
        (
            await db.execute(
                select(StinkyMemory).where(
                    StinkyMemory.user_id == user_id, StinkyMemory.kind == kind
                )
            )
        )
        .scalars()
        .all()
    )
    for row in same_kind:
        if _is_duplicate(row.text, clean):
            action = "unchanged" if _fold(row.text) == _fold(clean) else "updated"
            # Keep the longer, more specific wording (but never rewrite a note
            # that only differs in casing or accents: that is not a change).
            if action != "unchanged" and (
                len(clean) >= len(row.text) or _fold(row.text) in _fold(clean)
            ):
                row.text = clean
            row.source = source
            row.confidence = max(row.confidence, confidence)
            if pinned is not None:
                row.pinned = pinned
            row.updated_at = now
            await db.flush()
            return row, action

    memory = StinkyMemory(
        user_id=user_id,
        kind=kind,
        text=clean,
        source=source,
        confidence=confidence,
        pinned=bool(pinned),
    )
    db.add(memory)
    await db.flush()
    await _evict_if_needed(db, user_id)
    return memory, "created"


async def forget(
    db: AsyncSession,
    user_id: UUID,
    *,
    memory_id: UUID | None = None,
    text: str | None = None,
) -> list[str]:
    """Delete by id, or every note matching ``text``. Returns the texts removed."""
    if memory_id is not None:
        row = await get_memory(db, user_id, memory_id)
        if row is None:
            return []
        removed = row.text
        await db.delete(row)
        await db.flush()
        return [removed]

    needle = clean_memory_text(text)
    if len(needle) < 2:
        raise MemoryRefused("Say which note to forget (its id or its text).", code="empty")
    rows = await list_memories(db, user_id)
    victims = [r for r in rows if _is_duplicate(r.text, needle)]
    for row in victims:
        await db.delete(row)
    await db.flush()
    return [r.text for r in victims]


async def forget_call_name(db: AsyncSession, user_id: UUID) -> int:
    """Clear the preferred name; the rest of the notebook is untouched."""
    result = await db.execute(
        delete(StinkyMemory).where(
            StinkyMemory.user_id == user_id, StinkyMemory.kind == MEMORY_KIND_NAME
        )
    )
    return result.rowcount or 0


async def clear_memories(db: AsyncSession, user_id: UUID) -> int:
    """«Borrar todo»: wipe this user's notebook. The caller commits."""
    result = await db.execute(delete(StinkyMemory).where(StinkyMemory.user_id == user_id))
    return result.rowcount or 0


# --- Digest ------------------------------------------------------------------------------

#: Spanish label per kind, used both in the prompt digest and the UI grouping.
KIND_LABELS_ES: dict[str, str] = {
    "name": "Le gusta que le llamen",
    "preference": "Le gusta",
    "dislike": "No le gusta",
    "context": "Contexto",
    "plan": "Plan",
    "fact": "Dato",
}

DIGEST_HEADER = (
    "NOTAS DE STINKY (las escribes tú al hablar con esta persona; ella puede editarlas "
    "o borrarlas en Ajustes). Son pistas para vestirla, nunca datos que comentar:"
)


def _digest_sort_key(row: StinkyMemory) -> tuple:
    """Preferred name first, then pinned, then most recently used/updated."""
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    last_used = row.last_used_at or epoch
    updated = row.updated_at or epoch
    return (
        0 if row.kind == MEMORY_KIND_NAME else 1,
        0 if row.pinned else 1,
        -last_used.timestamp(),
        -updated.timestamp(),
    )


def render_digest(rows: list[StinkyMemory], max_chars: int = MAX_DIGEST_CHARS) -> str:
    """Short Markdown-ish digest of ``rows``, capped at ``max_chars``.

    Pinned and recently used notes win the space; the rest are simply dropped.
    Returns "" when there is nothing to say, so callers can omit the block.
    """
    if not rows:
        return ""
    lines: list[str] = []
    used = 0
    for row in sorted(rows, key=_digest_sort_key):
        label = KIND_LABELS_ES.get(row.kind, "Dato")
        line = f"- {label}: {row.text}"
        if used + len(line) + 1 > max_chars:
            continue
        lines.append(line)
        used += len(line) + 1
    if not lines:
        return ""
    return "\n".join(lines)


async def build_digest(
    db: AsyncSession,
    user_id: UUID,
    *,
    max_chars: int = MAX_DIGEST_CHARS,
    mark_used: bool = False,
) -> str:
    """The digest injected into Stinky's chat prompt (header + lines)."""
    rows = await list_memories(db, user_id)
    body = render_digest(rows, max_chars)
    if not body:
        return ""
    if mark_used:
        await touch_used(db, user_id, rows)
    return f"{DIGEST_HEADER}\n{body}"


async def touch_used(db: AsyncSession, user_id: UUID, rows: list[StinkyMemory]) -> None:
    """Record that these notes were served to a prompt (drives eviction order)."""
    if not rows:
        return
    now = datetime.now(UTC)
    for row in rows:
        row.last_used_at = now
    try:
        await db.flush()
    except Exception:  # never fail a chat turn over bookkeeping
        logger.warning("Could not update Stinky memory usage for %s", user_id, exc_info=True)


async def stylist_memory_lines(db: AsyncSession, user_id: UUID, *, max_chars: int = 400) -> str:
    """The useful subset for the stylist/pairing prompts.

    Those prompts describe taste, not the conversation, so one-off context and
    the preferred name are left out; what remains is what helps pick clothes.
    """
    rows = [
        r
        for r in await list_memories(db, user_id)
        if r.kind in ("preference", "dislike", "plan", "fact")
    ]
    return render_digest(rows, max_chars)
