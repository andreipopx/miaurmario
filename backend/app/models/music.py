"""Listening history + daily listening mood (Música tab)."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ListeningEvent(Base):
    """One play of a track. Spotify's recently-played only keeps the last 50
    plays, so the worker copies them here to build a longer history."""

    __tablename__ = "listening_events"
    __table_args__ = (
        UniqueConstraint("user_id", "track_id", "played_at", name="uq_listening_events_play"),
        Index("ix_listening_events_user_played", "user_id", "played_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    track_id: Mapped[str] = mapped_column(String(64), nullable=False)
    track_name: Mapped[str] = mapped_column(String(300), nullable=False)
    # Primary artist (denormalised for cheap GROUP BY) + every credited artist name.
    artist_id: Mapped[str | None] = mapped_column(String(64))
    artist_name: Mapped[str | None] = mapped_column(String(300))
    artists: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    album: Mapped[str | None] = mapped_column(String(300))
    release_year: Mapped[int | None] = mapped_column(Integer)
    image_url: Mapped[str | None] = mapped_column(String(500))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="spotify", server_default="spotify"
    )
    # Genres of the primary artist at sync time (Spotify often returns []).
    genres: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ListeningMood(Base):
    """Deterministic (optionally AI-refined) mood of one local day of listening."""

    __tablename__ = "listening_moods"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_listening_moods_day"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    # Spanish labels, strongest first ("melancólico", "eléctrico"...).
    moods: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    energy: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    valence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    top_genres: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    genre_counts: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    track_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    listened_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    dominant_artists: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    one_liner: Mapped[str | None] = mapped_column(String(280))
    # "heuristic" | "ai"
    method: Mapped[str] = mapped_column(
        String(16), nullable=False, default="heuristic", server_default="heuristic"
    )
    # Fingerprint of the plays the mood was computed from (skip no-op recomputes
    # and never re-spend an AI call on unchanged input).
    signature: Mapped[str | None] = mapped_column(String(64))
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
