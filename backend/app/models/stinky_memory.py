"""«Stinky recuerda»: the per-user memory Stinky writes while you chat with him.

One row = one short, human-readable note ("prefiere ropa oscura", "trabaja en
oficina los martes"). The rows are rendered to a small digest that goes into the
chat and stylist prompts, and the whole list is shown to the user in
Ajustes → Stinky recuerda, where they can edit, pin, delete or wipe it.

Nothing here is ever shared: memories are strictly per user (``user_id``), never
surface on social/family pages and are removed with the account (the FK is
``ON DELETE CASCADE``, which the GDPR deletion job discovers automatically).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# What Stinky may file a note under. ``name`` is special: it is the name the
# person asked to be called, and there is at most one of them per user.
MEMORY_KIND_NAME = "name"
MEMORY_KINDS: tuple[str, ...] = (
    MEMORY_KIND_NAME,
    "preference",
    "dislike",
    "context",
    "plan",
    "fact",
)

MEMORY_SOURCES: tuple[str, ...] = ("chat", "user", "system")

#: Hard cap on one note (the column is VARCHAR(200) too).
MAX_MEMORY_TEXT_CHARS = 200
#: Hard cap per user; adding past it evicts the oldest unpinned, least used note.
MAX_MEMORIES_PER_USER = 60


class StinkyMemory(Base):
    """One durable note Stinky keeps about a single user."""

    __tablename__ = "stinky_memories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    text: Mapped[str] = mapped_column(String(MAX_MEMORY_TEXT_CHARS), nullable=False)
    #: Who wrote it: "chat" (Stinky, while talking), "user" (edited in Ajustes),
    #: "system" (migrated/derived). Shown in the UI so the user knows.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="chat")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.8)
    #: Pinned notes survive eviction and go first into the prompt digest.
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    #: Last time this note made it into a prompt digest (drives eviction).
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_stinky_memories_user_kind", "user_id", "kind"),
        Index("ix_stinky_memories_user_updated", "user_id", "updated_at"),
    )
