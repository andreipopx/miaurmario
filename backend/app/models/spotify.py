"""Spotify integration model."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SpotifyConnection(Base):
    """OAuth connection to a user's Spotify account. One row per user.

    Mood input for the Stylist (currently playing / recently played /
    top-artist genres) and source of the Música tab's listening history.
    Tokens are Fernet-ciphered at rest.
    """

    __tablename__ = "spotify_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    spotify_user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    access_token_ct: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    refresh_token_ct: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    access_token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    scopes: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    use_for_mood: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Listening-history sync: recently-played `after` cursor (epoch ms) and the
    # time of the last successful sync (used to throttle on-demand syncs).
    history_cursor_ms: Mapped[int | None] = mapped_column(BigInteger)
    last_history_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
