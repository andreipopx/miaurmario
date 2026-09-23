"""Stinky chat ("Habla con Stinky"): conversations with the stylist cat."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

CHAT_ROLE_USER = "user"
CHAT_ROLE_ASSISTANT = "assistant"
CHAT_ROLE_TOOL = "tool"


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ChatMessage.seq",
    )

    __table_args__ = (Index("ix_chat_conversations_user_updated", "user_id", "updated_at"),)


class ChatMessage(Base):
    """One provider-level message.

    ``role`` is user | assistant | tool. Assistant rows may carry ``tool_calls``
    (the provider's function-call requests) and ``attachments`` (outfit cards
    shown in the UI). Tool rows carry ``tool_call_id`` + ``tool_name`` and the
    JSON result in ``content``.

    ``notes`` holds the memory notes Stinky wrote during the turn, as
    ``{"kind": ..., "text": ..., "action": "created" | "updated"}``, so the chat
    can show "Stinky ha tomado nota: ..." inline, also on reload.

    ``reasoning`` stores the provider's ``reasoning_content`` because DeepSeek's
    thinking mode requires it to be passed back on later requests that carry
    ``tools``. It is server-only: never returned by the API.
    """

    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Monotonic order inside a conversation (created_at can tie within a turn).
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    reasoning: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[list | None] = mapped_column(JSONB)
    tool_call_id: Mapped[str | None] = mapped_column(String(100))
    tool_name: Mapped[str | None] = mapped_column(String(64))
    attachments: Mapped[list | None] = mapped_column(JSONB)
    # "Stinky ha tomado nota: ..." — what he wrote to «Stinky recuerda» during
    # this turn, so the note stays visible when the conversation is reloaded.
    notes: Mapped[list | None] = mapped_column(JSONB)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    conversation: Mapped["ChatConversation"] = relationship(
        "ChatConversation", back_populates="messages"
    )

    __table_args__ = (Index("ix_chat_messages_conversation_seq", "conversation_id", "seq"),)
