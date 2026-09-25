import ipaddress
import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Channel-specific configurations
class NtfyConfig(BaseModel):
    server: str = "https://ntfy.sh"
    topic: str
    token: str | None = None

    @field_validator("server")
    @classmethod
    def validate_server(cls, v: str) -> str:
        if not v.startswith("http://") and not v.startswith("https://"):
            raise ValueError("Server URL must start with http:// or https://")
        if len(v) > 500:
            raise ValueError("Server URL must be 500 characters or fewer")
        return v.rstrip("/")

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, v: str) -> str:
        if not v or len(v) < 3:
            raise ValueError("Topic must be at least 3 characters")
        if not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Topic can only contain letters, numbers, - and _")
        return v


class MattermostConfig(BaseModel):
    webhook_url: str

    @field_validator("webhook_url")
    @classmethod
    def validate_webhook(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("Webhook URL must use HTTPS")
        if "/hooks/" not in v:
            raise ValueError("Invalid Mattermost webhook URL format")
        return v


class EmailConfig(BaseModel):
    address: str

    @field_validator("address")
    @classmethod
    def validate_email(cls, v: str) -> str:
        pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
        if not re.match(pattern, v):
            raise ValueError("Invalid email address")
        return v


class ExpoPushConfig(BaseModel):
    push_token: str

    @field_validator("push_token")
    @classmethod
    def validate_token(cls, v: str) -> str:
        if not v.startswith("ExponentPushToken[") and not v.startswith("ExpoPushToken["):
            raise ValueError("Invalid Expo push token format")
        return v


# Notification settings schemas
class NotificationSettingsBase(BaseModel):
    channel: Literal["ntfy", "mattermost", "email", "expo_push"]
    enabled: bool = True
    priority: int = 1
    config: dict


class NotificationSettingsCreate(NotificationSettingsBase):
    pass


class NotificationSettingsUpdate(BaseModel):
    enabled: bool | None = None
    priority: int | None = None
    config: dict | None = None


class NotificationSettingsResponse(NotificationSettingsBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


VALID_OCCASIONS = {"casual", "office", "formal", "date", "sporty", "outdoor", "work", "party"}


# Schedule schemas
class ScheduleBase(BaseModel):
    day_of_week: int  # 0=Monday, 6=Sunday (day to WEAR the outfit)
    notification_time: str  # HH:MM format
    occasion: str = "casual"
    enabled: bool = True
    notify_day_before: bool = False  # If True, notification comes evening before

    @field_validator("occasion")
    @classmethod
    def validate_occasion(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in VALID_OCCASIONS:
            raise ValueError(
                f"Invalid occasion. Must be one of: {', '.join(sorted(VALID_OCCASIONS))}"
            )
        return v

    @field_validator("day_of_week")
    @classmethod
    def validate_day(cls, v: int) -> int:
        if v < 0 or v > 6:
            raise ValueError("day_of_week must be 0-6 (Monday-Sunday)")
        return v

    @field_validator("notification_time")
    @classmethod
    def validate_time(cls, v: str) -> str:
        if not re.match(r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$", v):
            raise ValueError("notification_time must be in HH:MM format")
        return v


class ScheduleCreate(ScheduleBase):
    pass


class ScheduleUpdate(BaseModel):
    day_of_week: int | None = None
    notification_time: str | None = None
    occasion: str | None = None
    enabled: bool | None = None
    notify_day_before: bool | None = None

    @field_validator("occasion")
    @classmethod
    def validate_occasion(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip().lower()
            if v not in VALID_OCCASIONS:
                raise ValueError(
                    f"Invalid occasion. Must be one of: {', '.join(sorted(VALID_OCCASIONS))}"
                )
        return v

    @field_validator("notification_time")
    @classmethod
    def validate_time(cls, v: str | None) -> str | None:
        if v is not None and not re.match(r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$", v):
            raise ValueError("notification_time must be in HH:MM format")
        return v

    @field_validator("day_of_week")
    @classmethod
    def validate_day(cls, v: int | None) -> int | None:
        if v is not None and (v < 0 or v > 6):
            raise ValueError("day_of_week must be 0-6 (Monday-Sunday)")
        return v


class ScheduleResponse(BaseModel):
    id: UUID
    user_id: UUID
    day_of_week: int
    notification_time: str  # Converted from Time object
    occasion: str
    enabled: bool
    notify_day_before: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

    @field_validator("notification_time", mode="before")
    @classmethod
    def convert_time(cls, v):
        if hasattr(v, "strftime"):
            return v.strftime("%H:%M")
        return v


# Notification delivery tracking
class NotificationResponse(BaseModel):
    id: UUID
    user_id: UUID
    outfit_id: UUID | None
    channel: str
    status: str
    attempts: int
    sent_at: datetime | None
    delivered_at: datetime | None
    error_message: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class TestNotificationRequest(BaseModel):
    pass


class TestNotificationResponse(BaseModel):
    success: bool
    message: str


class MessageResponse(BaseModel):
    message: str


# Default channels (account email + Web Push) ---------------------------------


class EventToggles(BaseModel):
    friend_request: bool = True
    friend_accepted: bool = True
    daily_outfit: bool = True
    # Off until the user picks it up in Ajustes → Notificaciones.
    morning_look: bool = False
    friend_activity: bool = False


class EventTogglesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    friend_request: bool | None = None
    friend_accepted: bool | None = None
    daily_outfit: bool | None = None
    morning_look: bool | None = None
    friend_activity: bool | None = None


class NotificationPreferencesResponse(BaseModel):
    email: EventToggles
    push: EventToggles
    email_address: str
    email_available: bool
    push_available: bool
    vapid_public_key: str | None = None
    push_devices: int = 0
    # Local clock times (HH:MM) for the two once-a-day alerts.
    morning_look_time: str
    friend_activity_time: str

    @field_validator("morning_look_time", "friend_activity_time", mode="before")
    @classmethod
    def convert_time(cls, v):
        if hasattr(v, "strftime"):
            return v.strftime("%H:%M")
        return v


def _validate_hhmm(v: str | None) -> str | None:
    if v is not None and not re.match(r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$", v):
        raise ValueError("time must be in HH:MM format")
    return v


class NotificationPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EventTogglesPatch | None = None
    push: EventTogglesPatch | None = None
    morning_look_time: str | None = None
    friend_activity_time: str | None = None

    @field_validator("morning_look_time", "friend_activity_time")
    @classmethod
    def validate_times(cls, v: str | None) -> str | None:
        return _validate_hhmm(v)


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=16, max_length=255)
    auth: str = Field(min_length=8, max_length=255)


_BLOCKED_PUSH_HOSTS = {"localhost"}


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: PushKeys
    user_agent: str | None = Field(default=None, max_length=1000)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, v: str) -> str:
        # The worker POSTs to this URL: only public HTTPS push services, never
        # an internal host (docker service names have no dot, IPs are refused).
        parsed = urlparse(v)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or "." not in host:
            raise ValueError("Invalid push endpoint")
        if host in _BLOCKED_PUSH_HOSTS or host.endswith((".local", ".internal", ".home")):
            raise ValueError("Invalid push endpoint")
        try:
            ipaddress.ip_address(host.strip("[]"))
        except ValueError:
            pass
        else:
            raise ValueError("Invalid push endpoint")
        if parsed.port not in (None, 443):
            raise ValueError("Invalid push endpoint")
        return v


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=2048)


class PushTestResponse(BaseModel):
    sent: int
    removed: int
    failed: int


class UnsubscribeRequest(BaseModel):
    token: str | None = Field(default=None, max_length=512)
    all: bool = False
    resubscribe: bool = False


class UnsubscribeResponse(BaseModel):
    scope: str
    subscribed: bool
