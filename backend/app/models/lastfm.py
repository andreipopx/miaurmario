"""Last.fm integration model."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LastfmConnection(Base):
    """A user's Last.fm account: the music source for everyone who cannot use
    Spotify (the Spotify app is capped at 5 allow-listed users).

    Usually just a public username (scrobbles are public by default). When the
    optional web-auth flow is used, the session key is Fernet-ciphered at rest
    and requests are signed with it.
    """

    __tablename__ = "lastfm_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    session_key_ct: Mapped[bytes | None] = mapped_column(LargeBinary)
    use_for_mood: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Sync bookkeeping: `from` cursor for user.getRecentTracks (unix seconds of
    # the newest scrobble already stored) and the last successful sync.
    cursor_uts: Mapped[int | None] = mapped_column(BigInteger)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Short machine code of the last sync failure ("private", "not_found"...).
    last_error: Mapped[str | None] = mapped_column(String(32))
