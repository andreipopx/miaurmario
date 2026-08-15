"""Pinterest integration models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PinterestConnection(Base):
    """OAuth connection to a user's Pinterest account. One row per user."""

    __tablename__ = "pinterest_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    pinterest_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    access_token_ct: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    refresh_token_ct: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    access_token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    refresh_token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    scopes: Mapped[str] = mapped_column(
        String(255), default="boards:read,pins:read", nullable=False
    )
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PinterestPin(Base):
    """A Pinterest pin imported into the user's library."""

    __tablename__ = "pinterest_pins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pinterest_pin_id: Mapped[str] = mapped_column(String(64), nullable=False)
    board_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    board_name: Mapped[str | None] = mapped_column(String(255))
    image_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_link: Mapped[str | None] = mapped_column(String(1024))
    description: Mapped[str | None] = mapped_column(Text)
    dominant_color: Mapped[str | None] = mapped_column(String(9))
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "pinterest_pin_id", name="uq_pinterest_pins_user_pin"),
    )
