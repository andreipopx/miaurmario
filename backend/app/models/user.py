"""User model."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.family import Family
    from app.models.item import ClothingItem
    from app.models.learning import UserLearningProfile
    from app.models.notification import NotificationSettings
    from app.models.outfit import Outfit
    from app.models.preference import UserPreference
    from app.models.schedule import Schedule


class User(Base):
    """Represents an authenticated user."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("families.id", ondelete="SET NULL")
    )
    external_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(20), unique=True, index=True, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    # Uploaded profile photo (512px WebP) and its 128px thumb, relative to STORAGE_PATH.
    avatar_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_thumb_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="member")
    timezone: Mapped[str] = mapped_column(String(50), default="UTC")
    # Who chose the zone: "auto" (detected from the device or the chosen city)
    # or "manual" (the user picked it). Detection never overwrites "manual".
    # See app/services/location_service.py.
    timezone_source: Mapped[str] = mapped_column(
        String(10), nullable=False, default="auto", server_default="auto"
    )

    # Location for weather. City level only: the coordinates are rounded to 2
    # decimals (~1 km) before they are ever stored, so this is the city centre
    # and never the device's exact position.
    location_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 8))
    location_lon: Mapped[Decimal | None] = mapped_column(Numeric(11, 8))
    location_name: Mapped[str | None] = mapped_column(String(100))
    # When we last asked "¿Estás en Lisboa?" — caps that prompt to once a day.
    travel_prompt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Optional password (argon2id). NULL = magic-link only.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Social: reactions on my outfits newer than this are "new" (in-app badge).
    social_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    body_measurements: Mapped[dict | None] = mapped_column(JSONB)
    # First-run guidance already shown ("tour", "tip.wardrobe", ...): follows the
    # user across devices so the welcome tour and area tips appear only once.
    seen_tips: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    family: Mapped[Optional["Family"]] = relationship(
        "Family", back_populates="members", foreign_keys=[family_id]
    )
    preferences: Mapped[Optional["UserPreference"]] = relationship(
        "UserPreference", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    notification_settings: Mapped[list["NotificationSettings"]] = relationship(
        "NotificationSettings", back_populates="user", cascade="all, delete-orphan"
    )
    schedules: Mapped[list["Schedule"]] = relationship(
        "Schedule", back_populates="user", cascade="all, delete-orphan"
    )
    clothing_items: Mapped[list["ClothingItem"]] = relationship(
        "ClothingItem", back_populates="user", cascade="all, delete-orphan"
    )
    outfits: Mapped[list["Outfit"]] = relationship(
        "Outfit", back_populates="user", cascade="all, delete-orphan"
    )
    learning_profile: Mapped[Optional["UserLearningProfile"]] = relationship(
        "UserLearningProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
