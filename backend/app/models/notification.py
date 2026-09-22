import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.outfit import Outfit
    from app.models.user import User


class NotificationStatus(enum.StrEnum):
    pending = "pending"
    sent = "sent"
    delivered = "delivered"
    failed = "failed"
    retrying = "retrying"


class NotificationSettings(Base):
    __tablename__ = "notification_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    priority: Mapped[int] = mapped_column(Integer, default=1)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="notification_settings")

    __table_args__ = (
        # Unique constraint on user + channel
        {"sqlite_autoincrement": True},
    )


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    outfit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("outfits.id", ondelete="SET NULL")
    )
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[NotificationStatus] = mapped_column(
        Enum(NotificationStatus, name="notification_status"), default=NotificationStatus.pending
    )

    # Delivery tracking
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Content
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(Text)
    error_details: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User")
    outfit: Mapped[Optional["Outfit"]] = relationship("Outfit")


# Events users can be notified about through the default channels (account
# email + Web Push). Legacy channels (ntfy/Mattermost/SMTP/Expo) keep carrying
# only the daily outfit and wash reminders.
NOTIFICATION_EVENTS = ("friend_request", "friend_accepted", "daily_outfit")
DEFAULT_CHANNELS = ("email", "push")


class NotificationPreference(Base):
    """Per-user event x channel switches. No row means defaults (everything on).

    Push switches only matter once the user subscribed at least one device.
    """

    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    email_friend_request: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_friend_accepted: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_daily_outfit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    push_friend_request: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    push_friend_accepted: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    push_daily_outfit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def enabled(self, channel: str, event: str) -> bool:
        value = getattr(self, f"{channel}_{event}", None)
        # An unsaved row has no column defaults applied yet: None reads as on.
        return True if value is None else bool(value)

    def set(self, channel: str, event: str, value: bool) -> None:
        if channel not in DEFAULT_CHANNELS or event not in NOTIFICATION_EVENTS:
            raise ValueError(f"Unknown preference {channel}/{event}")
        setattr(self, f"{channel}_{event}", value)


class PushSubscription(Base):
    """One Web Push (VAPID) subscription, i.e. one browser/device of a user."""

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
