"""Orchestration of one "Habla con Stinky" turn.

``run_turn`` is an async generator of UI events (``{"event": ..., "data": ...}``)
that the API layer serialises as Server-Sent Events:

* ``meta``    {conversation_id, title}
* ``status``  {phase: "thinking" | "tool", tool?}   (also works as keep-alive)
* ``delta``   {text}                                   visible answer only
* ``outfit``  {card}                                   outfit card to render inline
* ``memory``  {note}                                   "Stinky ha tomado nota: ..."
* ``ping``    {}                                       keep-alive while a tool runs
* ``done``    {message_id, outfit_created, tokens}
* ``error``   {code, message}

The provider's ``reasoning_content`` is never emitted. It is persisted
server-side because DeepSeek's thinking mode requires it to be passed back in
later requests that carry ``tools``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.chat import (
    CHAT_ROLE_ASSISTANT,
    CHAT_ROLE_TOOL,
    CHAT_ROLE_USER,
    ChatConversation,
    ChatMessage,
)
from app.models.user import User
from app.services.ai_service import AIService
from app.services.item_service import ItemService
from app.services.recommendation_service import MIN_CANDIDATES_FOR_OUTFIT
from app.services.stinky_chat.provider import (
    CompletionResult,
    ProviderError,
    stream_completion,
)
from app.services.stinky_chat.tools import (
    TOOL_DEFINITIONS,
    ToolContext,
    clean_text,
    run_tool,
)
from app.services.stinky_memory import build_digest, get_call_name
from app.utils.prompts import load_prompt

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 10.0
THINKING_STATUS_EVERY = 5.0
OLD_TOOL_RESULT_CHARS = 1500
FALLBACK_ES = "Se me ha enredado el ovillo y no he podido contestar. ¿Lo intentamos otra vez?"
FALLBACK_EN = "I got tangled in my yarn and couldn't answer. Shall we try again?"

_WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _event(name: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"event": name, "data": data or {}}


def describe_wardrobe(counts: dict[str, int] | None) -> str:
    """One line for CONTEXTO saying how much of a wardrobe there is to work with.

    Stinky gets this without asking, because "the wardrobe is empty" is the one
    fact he needs before he opens his mouth, and because the two ways of being
    empty need different answers: no photos at all, or photos he cannot see
    because nothing has a type yet.
    """
    if counts is None:
        return "no lo he podido consultar; si hace falta, usa get_wardrobe."
    usable = counts.get("usable", 0)
    untyped = counts.get("untyped", 0)
    total = counts.get("total", 0)
    if total == 0:
        return "VACÍO. No ha subido ninguna prenda todavía."
    parts = [f"{usable} prenda(s) que puedes usar"]
    if untyped:
        parts.append(f"{untyped} foto(s) sin etiquetar, que para ti no existen (sin tipo)")
    parts.append(f"{total} en total")
    tail = "; ".join(parts)
    if usable < MIN_CANDIDATES_FOR_OUTFIT:
        return f"{tail}. CASI VACÍO: aún no puedes montar un look completo."
    return f"{tail}."


def build_system_prompt(
    user: User,
    locale: str,
    memory_digest: str = "",
    call_name: str | None = None,
    wardrobe_counts: dict[str, int] | None = None,
) -> str:
    """The Stinky system prompt for this user, this locale and this notebook.

    ``memory_digest`` is the capped «Stinky recuerda» block (see
    ``app.services.stinky_memory``); it is empty until he has written something.
    ``call_name`` is the name the person asked to be called, which wins over the
    account display name in greetings. ``wardrobe_counts`` comes from
    ``ItemService.get_wardrobe_counts``.
    """
    try:
        tz = ZoneInfo(user.timezone or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    now = datetime.now(UTC).astimezone(tz)
    weekdays = _WEEKDAYS_EN if locale == "en" else _WEEKDAYS_ES
    account_name = clean_text(user.display_name, 40) or ("—")
    preferred = clean_text(call_name, 40)
    replacements = {
        "{language}": "inglés" if locale == "en" else "español",
        "{weekday}": weekdays[now.weekday()],
        "{today}": now.date().isoformat(),
        "{timezone}": str(tz),
        "{user_name}": json.dumps(account_name, ensure_ascii=False),
        "{call_name}": (
            json.dumps(preferred, ensure_ascii=False)
            if preferred
            else "— (no te lo ha dicho; usa el nombre de la cuenta o ninguno)"
        ),
        "{memory_digest}": memory_digest
        or "(Tu cuaderno está vacío: todavía no has anotado nada de esta persona.)",
        "{wardrobe_state}": describe_wardrobe(wardrobe_counts),
        "{max_batch}": str(get_settings().max_bulk_upload_count),
    }
    prompt = load_prompt("stinky_chat")
    for key, value in replacements.items():
        prompt = prompt.replace(key, value)
    return prompt


# --- Conversations ------------------------------------------------------------------------


async def get_owned_conversation(
    db: AsyncSession, user_id: UUID, conversation_id: UUID
) -> ChatConversation | None:
    result = await db.execute(
        select(ChatConversation).where(
            ChatConversation.id == conversation_id, ChatConversation.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def prune_conversations(db: AsyncSession, user_id: UUID, keep: int) -> None:
    """Keep only the ``keep`` most recently updated conversations of this user."""
    result = await db.execute(
        select(ChatConversation.id)
        .where(ChatConversation.user_id == user_id)
        .order_by(ChatConversation.updated_at.desc(), ChatConversation.created_at.desc())
        .offset(keep)
    )
    stale = [row[0] for row in result.all()]
    if stale:
        await db.execute(
            delete(ChatConversation).where(
                ChatConversation.id.in_(stale), ChatConversation.user_id == user_id
            )
        )


async def _next_seq(db: AsyncSession, conversation_id: UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(ChatMessage.seq), 0)).where(
            ChatMessage.conversation_id == conversation_id
        )
    )
    return int(result.scalar_one()) + 1


def _truncate(text: str | None, limit: int) -> str:
    text = text or ""
    return text if len(text) <= limit else text[:limit] + "…(truncated)"


def sanitize_history(rows: list[ChatMessage]) -> list[ChatMessage]:
    """Drop leading non-user rows and assistant tool-call groups missing results."""
    while rows and rows[0].role != CHAT_ROLE_USER:
        rows = rows[1:]
    clean: list[ChatMessage] = []
    i = 0
    while i < len(rows):
        row = rows[i]
        if row.role == CHAT_ROLE_ASSISTANT and row.tool_calls:
            ids = {tc.get("id") for tc in row.tool_calls if isinstance(tc, dict)}
            j = i + 1
            results: list[ChatMessage] = []
            while j < len(rows) and rows[j].role == CHAT_ROLE_TOOL:
                results.append(rows[j])
                j += 1
            if ids and ids == {r.tool_call_id for r in results}:
                clean.append(row)
                clean.extend(results)
            i = j
            continue
        if row.role == CHAT_ROLE_TOOL:  # orphan tool result
            i += 1
            continue
        clean.append(row)
        i += 1
    return clean


def history_to_messages(rows: list[ChatMessage], current_turn_start: int) -> list[dict]:
    messages: list[dict[str, Any]] = []
    for row in rows:
        if row.role == CHAT_ROLE_USER:
            messages.append({"role": "user", "content": row.content or ""})
        elif row.role == CHAT_ROLE_ASSISTANT:
            msg: dict[str, Any] = {"role": "assistant", "content": row.content or ""}
            if row.tool_calls:
                msg["tool_calls"] = row.tool_calls
            if row.reasoning:
                msg["reasoning_content"] = row.reasoning
            messages.append(msg)
        elif row.role == CHAT_ROLE_TOOL:
            content = row.content or ""
            if row.seq < current_turn_start:
                content = _truncate(content, OLD_TOOL_RESULT_CHARS)
            messages.append({"role": "tool", "tool_call_id": row.tool_call_id, "content": content})
    return messages


async def load_history(db: AsyncSession, conversation_id: UUID, limit: int) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.seq.desc())
        .limit(limit)
    )
    rows = list(reversed(result.scalars().all()))
    return sanitize_history(rows)


# --- Turn ---------------------------------------------------------------------------------


class _Turn:
    def __init__(self, db: AsyncSession, conversation: ChatConversation, seq: int):
        self.db = db
        self.conversation = conversation
        self.seq = seq

    def add(self, **fields: Any) -> ChatMessage:
        self.seq += 1
        msg = ChatMessage(conversation_id=self.conversation.id, seq=self.seq, **fields)
        self.db.add(msg)
        return msg

    async def commit(self) -> None:
        self.conversation.updated_at = datetime.now(UTC)
        await self.db.commit()


async def run_turn(
    db: AsyncSession,
    user: User,
    ai: AIService,
    conversation: ChatConversation,
    user_text: str,
    locale: str = "es",
    *,
    stream_fn=None,
) -> AsyncIterator[dict[str, Any]]:
    settings = get_settings()
    stream_fn = stream_fn or stream_completion
    yield _event("meta", {"conversation_id": str(conversation.id), "title": conversation.title})

    turn = _Turn(db, conversation, await _next_seq(db, conversation.id) - 1)
    user_msg = turn.add(role=CHAT_ROLE_USER, content=user_text)
    await turn.commit()
    turn_start = user_msg.seq

    rows = await load_history(db, conversation.id, settings.stinky_chat_history_messages)
    # What Stinky already wrote down about this person (capped, pinned first).
    try:
        digest = await build_digest(db, user.id, mark_used=True)
        call_name = await get_call_name(db, user.id)
        await db.commit()
    except Exception:  # the notebook is a nice-to-have: never break a turn over it
        logger.warning("Could not load Stinky memory", exc_info=True)
        await db.rollback()
        digest, call_name = "", None
    # Cheap (one aggregate) and worth it every turn: it is what stops him
    # inventing a look out of an empty wardrobe.
    try:
        wardrobe_counts: dict[str, int] | None = await ItemService(db).get_wardrobe_counts(user.id)
    except Exception:
        logger.warning("Could not count the wardrobe for the Stinky prompt", exc_info=True)
        wardrobe_counts = None
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": build_system_prompt(user, locale, digest, call_name, wardrobe_counts),
        },
        *history_to_messages(rows, turn_start),
    ]

    ctx = ToolContext(db=db, user=user, conversation_id=conversation.id)
    emitted_cards = 0
    emitted_notes = 0
    rounds = 0
    tokens_used = 0
    visible_text = ""
    last_status = 0.0

    while True:
        tools_allowed = (
            rounds < settings.stinky_chat_max_tool_rounds
            and tokens_used < settings.stinky_chat_turn_token_budget
        )
        result: CompletionResult | None = None
        round_has_text = False
        try:
            async for ev in stream_fn(
                ai,
                messages,
                tools=TOOL_DEFINITIONS,
                tool_choice=None if tools_allowed else "none",
            ):
                if ev.kind == "content":
                    text = ev.text
                    if not round_has_text and visible_text and not visible_text.endswith("\n"):
                        text = "\n\n" + text.lstrip()
                    round_has_text = True
                    visible_text += text
                    yield _event("delta", {"text": text})
                elif ev.kind == "reasoning":
                    now = time.monotonic()
                    if now - last_status >= THINKING_STATUS_EVERY:
                        last_status = now
                        yield _event("status", {"phase": "thinking"})
                elif ev.kind == "final":
                    result = ev.result
        except ProviderError as e:
            logger.warning("Stinky chat provider error: %s", e)
            if visible_text.strip():
                turn.add(
                    role=CHAT_ROLE_ASSISTANT,
                    content=visible_text,
                    attachments=ctx.cards,
                    notes=ctx.notes or None,
                )
                await turn.commit()
            yield _event(
                "error",
                {
                    "code": "provider_error",
                    "message": FALLBACK_EN if locale == "en" else FALLBACK_ES,
                },
            )
            return

        if result is None:  # defensive: stream ended without a final event
            result = CompletionResult()
        tokens_used += result.total_tokens

        if result.tool_calls and tools_allowed:
            rounds += 1
            call_msgs = [tc.to_message() for tc in result.tool_calls]
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": result.content or "",
                "tool_calls": call_msgs,
            }
            if result.reasoning:
                assistant_msg["reasoning_content"] = result.reasoning
            messages.append(assistant_msg)
            pending = [
                {
                    "role": CHAT_ROLE_ASSISTANT,
                    "content": result.content or None,
                    "reasoning": result.reasoning or None,
                    "tool_calls": call_msgs,
                    "prompt_tokens": result.prompt_tokens,
                    "completion_tokens": result.completion_tokens,
                }
            ]
            for call in result.tool_calls:
                yield _event("status", {"phase": "tool", "tool": call.name})
                task = asyncio.ensure_future(run_tool(ctx, call.name, call.arguments))
                try:
                    while not task.done():
                        await asyncio.wait({task}, timeout=HEARTBEAT_SECONDS)
                        if not task.done():
                            yield _event("ping")
                    output = task.result()
                finally:
                    if not task.done():
                        task.cancel()
                messages.append({"role": "tool", "tool_call_id": call.id, "content": output})
                pending.append(
                    {
                        "role": CHAT_ROLE_TOOL,
                        "content": output,
                        "tool_call_id": call.id,
                        "tool_name": call.name[:64],
                    }
                )
                while emitted_cards < len(ctx.cards):
                    yield _event("outfit", {"card": ctx.cards[emitted_cards]})
                    emitted_cards += 1
                while emitted_notes < len(ctx.notes):
                    yield _event("memory", {"note": ctx.notes[emitted_notes]})
                    emitted_notes += 1
            for fields in pending:
                turn.add(**fields)
            await turn.commit()
            continue

        # Final answer (tool calls requested past the cap are ignored).
        content = result.content or ""
        if not content.strip() and not visible_text.strip():
            content = FALLBACK_EN if locale == "en" else FALLBACK_ES
            visible_text += content
            yield _event("delta", {"text": content})
        final = turn.add(
            role=CHAT_ROLE_ASSISTANT,
            content=content or None,
            reasoning=result.reasoning or None,
            attachments=ctx.cards or None,
            notes=ctx.notes or None,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
        )
        await turn.commit()
        yield _event(
            "done",
            {
                "message_id": str(final.id),
                "outfit_created": ctx.outfit_created,
                "tool_rounds": rounds,
                "tokens": tokens_used,
            },
        )
        return
