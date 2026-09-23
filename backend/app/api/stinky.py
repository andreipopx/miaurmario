"""Stinky chat ("Habla con Stinky"): streaming chat with the stylist cat + history."""

import json
import logging
from collections.abc import AsyncIterator
from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.config import get_settings
from app.database import get_db
from app.models.chat import (
    CHAT_ROLE_ASSISTANT,
    CHAT_ROLE_USER,
    ChatConversation,
    ChatMessage,
)
from app.models.user import User
from app.services.ai_access import AIAccessError, ai_error_detail, require_ai_client
from app.services.ai_service import AIDisabledError, AIService
from app.services.stinky_chat.service import (
    get_owned_conversation,
    prune_conversations,
    run_turn,
)
from app.services.stinky_chat.tools import (
    MAX_OUTFIT_ITEMS,
    ToolError,
    clean_text,
    create_chat_outfit,
    load_owned_items,
    normalize_occasion,
    outfit_card,
)
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user
from app.utils.signed_urls import sign_image_url
from app.utils.timezone import get_user_today

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stinky", tags=["Stinky chat"])

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    # nginx buffers proxied responses by default; this disables it per response.
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


# --- Schemas --------------------------------------------------------------------------


class ChatRequest(BaseModel):
    conversation_id: UUID | None = None
    message: str = Field(min_length=1)
    locale: Literal["es", "en"] = "es"

    @field_validator("message")
    @classmethod
    def _clean_message(cls, v: str) -> str:
        v = v.replace("\x00", "").strip()
        if not v:
            raise ValueError("Message is empty")
        limit = get_settings().stinky_chat_max_message_chars
        if len(v) > limit:
            raise ValueError(f"Message must be {limit} characters or less")
        return v


class CardItem(BaseModel):
    id: str
    name: str | None = None
    type: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None


class OutfitCard(BaseModel):
    kind: Literal["created", "proposed"]
    outfit_id: str | None = None
    name: str | None = None
    occasion: str | None = None
    scheduled_for: str | None = None
    items: list[CardItem]


class ConversationSummary(BaseModel):
    id: UUID
    title: str | None = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ConversationList(BaseModel):
    conversations: list[ConversationSummary]


class MemoryNote(BaseModel):
    """ "Stinky ha tomado nota: ..." — what he wrote to «Stinky recuerda»."""

    kind: str
    text: str
    action: Literal["created", "updated", "deleted"] = "created"


class ChatMessageOut(BaseModel):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    cards: list[OutfitCard] = []
    notes: list[MemoryNote] = []
    created_at: datetime


class ConversationDetail(BaseModel):
    id: UUID
    title: str | None = None
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessageOut]


class SaveOutfitRequest(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=MAX_OUTFIT_ITEMS)
    name: str | None = Field(default=None, max_length=100)
    occasion: str | None = Field(default=None, max_length=50)
    scheduled_for: date | None = None
    # When saving a card shown in a chat message, mark that card as saved.
    message_id: UUID | None = None
    card_index: int | None = Field(default=None, ge=0, le=20)


class SaveOutfitResponse(BaseModel):
    card: OutfitCard


# --- Helpers --------------------------------------------------------------------------


def card_for_client(card: dict[str, Any]) -> dict[str, Any]:
    """Sign image paths; never leak raw storage paths or unknown keys."""
    items = []
    for it in card.get("items") or []:
        if not isinstance(it, dict):
            continue
        thumb = it.get("thumbnail_path")
        image = it.get("image_path")
        items.append(
            {
                "id": str(it.get("id")),
                "name": it.get("name"),
                "type": it.get("type"),
                "thumbnail_url": sign_image_url(thumb) if thumb else None,
                "image_url": sign_image_url(image) if image else None,
            }
        )
    return {
        "kind": "created" if card.get("kind") == "created" else "proposed",
        "outfit_id": card.get("outfit_id"),
        "name": card.get("name"),
        "occasion": card.get("occasion"),
        "scheduled_for": card.get("scheduled_for"),
        "items": items,
    }


def note_for_client(note: dict[str, Any]) -> dict[str, Any]:
    """Only the three keys the chat renders; text is capped like any tool data."""
    action = note.get("action")
    return {
        "kind": clean_text(note.get("kind"), 20) or "fact",
        "text": clean_text(note.get("text"), 200) or "",
        "action": action if action in ("created", "updated", "deleted") else "created",
    }


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _ai_http_error(e: AIDisabledError) -> HTTPException:
    if isinstance(e, AIAccessError):
        code, detail = ai_error_detail(e)
        return HTTPException(status_code=code, detail=detail)
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"code": "ai_disabled", "message": "AI is disabled on this server."},
    )


async def _chat_stream(
    bind: Any,
    user_id: UUID,
    conversation_id: UUID,
    ai: AIService,
    message: str,
    locale: str,
) -> AsyncIterator[str]:
    """Runs on its own session: the request-scoped one may be closed while streaming."""
    # Comment line first so proxies/clients see bytes immediately.
    yield ": stinky\n\n"
    async with AsyncSession(bind=bind, expire_on_commit=False) as db:
        try:
            user = (
                await db.execute(
                    select(User).where(User.id == user_id).options(selectinload(User.preferences))
                )
            ).scalar_one()
            conversation = await get_owned_conversation(db, user_id, conversation_id)
            if conversation is None:
                yield sse("error", {"code": "not_found", "message": "Conversation not found"})
                return
            async for ev in run_turn(db, user, ai, conversation, message, locale):
                name, data = ev["event"], ev["data"]
                if name == "ping":
                    yield ": ping\n\n"
                    continue
                if name == "outfit":
                    data = {"card": card_for_client(data["card"])}
                elif name == "memory":
                    data = {"note": note_for_client(data["note"])}
                yield sse(name, data)
        except Exception:
            logger.exception("Stinky chat turn failed")
            yield sse("error", {"code": "internal_error", "message": "Something went wrong."})


# --- Endpoints ------------------------------------------------------------------------


@router.post("/chat")
async def chat(
    request: ChatRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    settings = get_settings()
    await rate_limit_by_user(
        current_user.id,
        "stinky_chat",
        max_requests=settings.stinky_chat_rate_limit_per_minute,
        window_seconds=60,
    )
    await rate_limit_by_user(
        current_user.id,
        "stinky_chat_day",
        max_requests=settings.stinky_chat_rate_limit_per_day,
        window_seconds=86400,
    )

    try:
        ai = await require_ai_client(db, current_user, "text")
    except AIDisabledError as e:
        raise _ai_http_error(e) from None

    if request.conversation_id is not None:
        conversation = await get_owned_conversation(db, current_user.id, request.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = ChatConversation(
            user_id=current_user.id, title=clean_text(request.message, 60)
        )
        db.add(conversation)
        await db.flush()
        await prune_conversations(db, current_user.id, settings.stinky_chat_max_conversations)
    conversation_id = conversation.id
    await db.commit()

    return StreamingResponse(
        _chat_stream(
            db.bind, current_user.id, conversation_id, ai, request.message, request.locale
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/conversations", response_model=ConversationList)
async def list_conversations(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ConversationList:
    counts = (
        select(ChatMessage.conversation_id, func.count().label("n"))
        .where(ChatMessage.role.in_([CHAT_ROLE_USER, CHAT_ROLE_ASSISTANT]))
        .where(ChatMessage.content.is_not(None))
        .group_by(ChatMessage.conversation_id)
        .subquery()
    )
    result = await db.execute(
        select(ChatConversation, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.conversation_id == ChatConversation.id)
        .where(ChatConversation.user_id == current_user.id)
        .order_by(ChatConversation.updated_at.desc())
        .limit(get_settings().stinky_chat_max_conversations)
    )
    return ConversationList(
        conversations=[
            ConversationSummary(
                id=c.id,
                title=c.title,
                created_at=c.created_at,
                updated_at=c.updated_at,
                message_count=int(n),
            )
            for c, n in result.all()
        ]
    )


def _collapse_messages(rows: list[ChatMessage]) -> list[ChatMessageOut]:
    """One bubble per user message and one per assistant turn (tool rounds merged)."""
    out: list[ChatMessageOut] = []
    current: ChatMessageOut | None = None
    for row in rows:
        if row.role == CHAT_ROLE_USER:
            current = None
            out.append(
                ChatMessageOut(
                    id=row.id, role="user", content=row.content or "", created_at=row.created_at
                )
            )
            continue
        if row.role != CHAT_ROLE_ASSISTANT:
            continue
        text = (row.content or "").strip()
        cards = [
            OutfitCard(**card_for_client(c)) for c in (row.attachments or []) if isinstance(c, dict)
        ]
        notes = [MemoryNote(**note_for_client(n)) for n in (row.notes or []) if isinstance(n, dict)]
        if current is None:
            current = ChatMessageOut(
                id=row.id, role="assistant", content="", created_at=row.created_at
            )
            out.append(current)
        if text:
            current.content = f"{current.content}\n\n{text}" if current.content else text
        if cards:
            current.cards = cards  # the final row carries every card of the turn
        if notes:
            current.notes = notes  # same for the memory notes
        current.id = row.id  # the final row id (used to mark cards as saved)
    return [m for m in out if m.role == "user" or m.content or m.cards or m.notes]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ConversationDetail:
    conversation = await get_owned_conversation(db, current_user.id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = (
        (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation.id)
                .order_by(ChatMessage.seq)
            )
        )
        .scalars()
        .all()
    )
    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=_collapse_messages(list(rows)),
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    conversation = await get_owned_conversation(db, current_user.id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conversation)
    await db.commit()


@router.post("/outfits", response_model=SaveOutfitResponse, status_code=201)
async def save_outfit(
    request: SaveOutfitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SaveOutfitResponse:
    """Save an outfit card proposed in the chat ("Guardar")."""
    await rate_limit_by_user(current_user.id, "stinky_save", max_requests=30, window_seconds=60)
    item_ids = list(dict.fromkeys(request.item_ids))

    message: ChatMessage | None = None
    if request.message_id is not None:
        message = (
            await db.execute(
                select(ChatMessage)
                .join(ChatConversation, ChatConversation.id == ChatMessage.conversation_id)
                .where(
                    ChatMessage.id == request.message_id,
                    ChatConversation.user_id == current_user.id,
                )
            )
        ).scalar_one_or_none()
        if message is None:
            raise HTTPException(status_code=404, detail="Message not found")

    if request.scheduled_for is not None and request.scheduled_for < get_user_today(current_user):
        raise HTTPException(status_code=400, detail="Date is in the past")
    try:
        await load_owned_items(db, current_user.id, item_ids)
        outfit = await create_chat_outfit(
            db,
            current_user,
            item_ids,
            name=clean_text(request.name, 100),
            occasion=normalize_occasion(request.occasion),
            scheduled_for=request.scheduled_for,
        )
    except ToolError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "items_not_owned", "message": "Some items are not in your wardrobe"},
        ) from None

    card = outfit_card(outfit, "created")
    if message is not None and request.card_index is not None:
        cards = list(message.attachments or [])
        if request.card_index < len(cards) and isinstance(cards[request.card_index], dict):
            cards[request.card_index] = card
            message.attachments = cards
            flag_modified(message, "attachments")
            await db.commit()
    return SaveOutfitResponse(card=OutfitCard(**card_for_client(card)))
