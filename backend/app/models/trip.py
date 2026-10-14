"""«Modo viaje»: a trip and the plan Stinky made for it."""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Trip(Base):
    """A destination, dates and plans, and what to wear and pack for them.

    The plan lives on the row, not as outfits: a trip is a proposal you look at,
    tweak and pack from, and it should not fill the calendar or the history with
    looks nobody wore. ``days``: ``[{date, weather, item_ids, note}]``; ``packing``:
    ``[{item_id, packed}]`` (every garment the days use, once); ``extras``: a few
    non-wardrobe things worth packing («paraguas plegable»).

    ``status``: planning → ready, or error (``error`` says why).
    """

    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    destination: Mapped[str] = mapped_column(String(120), nullable=False)
    country: Mapped[str | None] = mapped_column(String(80))
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    timezone: Mapped[str | None] = mapped_column(String(64))
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    plans: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="planning", nullable=False)
    engine: Mapped[str | None] = mapped_column(String(16))
    error: Mapped[str | None] = mapped_column(String(64))
    days: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    packing: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    extras: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
