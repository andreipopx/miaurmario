import enum
import uuid
from datetime import datetime, time
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, Time, func
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
NOTIFICATION_EVENTS = (
    "friend_request",
    "friend_accepted",
    "daily_outfit",
    "morning_look",
    "friend_activity",
)
DEFAULT_CHANNELS = ("email", "push")

# The two events that go out once a day at a time the user picks, in their own
# timezone. ``TIMED_EVENT_DEFAULT_TIME`` is the local clock time used until they
# change it.
TIMED_EVENTS = ("morning_look", "friend_activity")
TIMED_EVENT_DEFAULT_TIME = {
    # The look of the morning lands before you get dressed...
    "morning_look": time(7, 30),
    # ...and what your friends did lands once, in the evening.
    "friend_activity": time(20, 0),
}

# What a user gets before touching anything. The morning look is off until they
# turn it on (it needs a time); friend activity buzzes the phone but never mails.
EVENT_DEFAULTS: dict[str, dict[str, bool]] = {
    "friend_request": {"email": True, "push": True},
    "friend_accepted": {"email": True, "push": True},
    "daily_outfit": {"email": True, "push": True},
    "morning_look": {"email": False, "push": False},
    "friend_activity": {"email": False, "push": True},
}


class NotificationPreference(Base):
    """Per-user event x channel switches, plus the local time the daily alerts go out.

    No row means ``EVENT_DEFAULTS``. Push switches only matter once the user
    subscribed at least one device.
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
    email_morning_look: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    push_morning_look: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_friend_activity: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    push_friend_activity: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Local clock times (the user's own timezone), never UTC.
    morning_look_time: Mapped[time] = mapped_column(
        Time, default=TIMED_EVENT_DEFAULT_TIME["morning_look"], nullable=False
    )
    friend_activity_time: Mapped[time] = mapped_column(
        Time, default=TIMED_EVENT_DEFAULT_TIME["friend_activity"], nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def enabled(self, channel: str, event: str) -> bool:
        value = getattr(self, f"{channel}_{event}", None)
        # An unsaved row has no column defaults applied yet: fall back to them.
        if value is None:
            return EVENT_DEFAULTS.get(event, {}).get(channel, True)
        return bool(value)

    def set(self, channel: str, event: str, value: bool) -> None:
        if channel not in DEFAULT_CHANNELS or event not in NOTIFICATION_EVENTS:
            raise ValueError(f"Unknown preference {channel}/{event}")
        setattr(self, f"{channel}_{event}", value)

    def time_for(self, event: str) -> time:
        """The local time ``event`` goes out at (its default on an unsaved row)."""
        if event not in TIMED_EVENTS:
            raise ValueError(f"Event {event} has no time")
        return getattr(self, f"{event}_time", None) or TIMED_EVENT_DEFAULT_TIME[event]

    def set_time(self, event: str, value: time) -> None:
        if event not in TIMED_EVENTS:
            raise ValueError(f"Event {event} has no time")
        setattr(self, f"{event}_time", value)


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
