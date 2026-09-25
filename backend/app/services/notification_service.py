import logging
from dataclasses import dataclass
from datetime import UTC, datetime, time
from enum import StrEnum
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.notification import Notification, NotificationSettings, NotificationStatus
from app.models.outfit import Outfit, OutfitItem
from app.models.schedule import Schedule
from app.models.user import User
from app.schemas.notification import EmailConfig, ExpoPushConfig, MattermostConfig, NtfyConfig
from app.services.event_notifications import (
    CHANNEL_ACCOUNT_EMAIL,
    CHANNEL_WEB_PUSH,
    default_channels_for,
    send_default_channels,
)
from app.services.notification_providers import (
    EmailMessage,
    EmailProvider,
    ExpoPushMessage,
    ExpoPushProvider,
    MattermostAttachment,
    MattermostMessage,
    MattermostProvider,
    NtfyNotification,
    NtfyProvider,
)
from app.services.web_push import PushPayload
from app.utils.email_templates import render_outfit_email
from app.utils.occasions import ascii_fold, occasion_label_es

logger = logging.getLogger(__name__)


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class NotificationResult:
    channel: str
    status: DeliveryStatus
    error: str | None = None
    response: dict | None = None


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Notification Settings CRUD
    async def get_user_settings(self, user_id: UUID) -> list[NotificationSettings]:
        result = await self.db.execute(
            select(NotificationSettings)
            .where(NotificationSettings.user_id == user_id)
            .order_by(NotificationSettings.priority)
        )
        return list(result.scalars().all())

    async def get_setting_by_id(
        self, setting_id: UUID, user_id: UUID
    ) -> NotificationSettings | None:
        result = await self.db.execute(
            select(NotificationSettings).where(
                and_(
                    NotificationSettings.id == setting_id,
                    NotificationSettings.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_setting(
        self, user_id: UUID, channel: str, enabled: bool, priority: int, config: dict
    ) -> NotificationSettings:
        # Check if channel already exists
        existing = await self.db.execute(
            select(NotificationSettings).where(
                and_(
                    NotificationSettings.user_id == user_id,
                    NotificationSettings.channel == channel,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"Channel {channel} already configured")

        setting = NotificationSettings(
            user_id=user_id,
            channel=channel,
            enabled=enabled,
            priority=priority,
            config=config,
        )
        self.db.add(setting)
        await self.db.flush()
        await self.db.refresh(setting)
        return setting

    async def update_setting(
        self,
        setting_id: UUID,
        user_id: UUID,
        enabled: bool | None = None,
        priority: int | None = None,
        config: dict | None = None,
    ) -> NotificationSettings | None:
        setting = await self.get_setting_by_id(setting_id, user_id)
        if not setting:
            return None

        if enabled is not None:
            setting.enabled = enabled
        if priority is not None:
            setting.priority = priority
        if config is not None:
            setting.config = config

        await self.db.flush()
        await self.db.refresh(setting)
        return setting

    async def delete_setting(self, setting_id: UUID, user_id: UUID) -> bool:
        setting = await self.get_setting_by_id(setting_id, user_id)
        if not setting:
            return False

        await self.db.delete(setting)
        await self.db.flush()
        return True

    async def test_setting(self, setting_id: UUID, user_id: UUID) -> tuple[bool, str]:
        setting = await self.get_setting_by_id(setting_id, user_id)
        if not setting:
            return False, "Setting not found"

        try:
            if setting.channel == "ntfy":
                success, message = await NtfyProvider(
                    NtfyConfig(**setting.config)
                ).test_connection()
            elif setting.channel == "mattermost":
                success, message = await MattermostProvider(
                    MattermostConfig(**setting.config)
                ).test_connection()
            elif setting.channel == "email":
                success, message = await EmailProvider(
                    EmailConfig(**setting.config)
                ).test_connection()
            elif setting.channel == "expo_push":
                success, message = await ExpoPushProvider(
                    ExpoPushConfig(**setting.config)
                ).test_connection()
            else:
                return False, f"Unknown channel: {setting.channel}"

            return success, message
        except Exception as e:
            return False, str(e)

    async def get_user_schedules(self, user_id: UUID) -> list[Schedule]:
        result = await self.db.execute(select(Schedule).where(Schedule.user_id == user_id))
        return list(result.scalars().all())

    async def get_schedule_by_id(self, schedule_id: UUID, user_id: UUID) -> Schedule | None:
        result = await self.db.execute(
            select(Schedule).where(and_(Schedule.id == schedule_id, Schedule.user_id == user_id))
        )
        return result.scalar_one_or_none()

    async def create_schedule(
        self,
        user_id: UUID,
        day_of_week: int,
        notification_time: time,
        occasion: str,
        enabled: bool,
        notify_day_before: bool,
    ) -> Schedule:
        existing = await self.db.execute(
            select(Schedule).where(
                and_(
                    Schedule.user_id == user_id,
                    Schedule.day_of_week == day_of_week,
                    Schedule.notification_time == notification_time,
                    Schedule.occasion == occasion,
                    Schedule.notify_day_before == notify_day_before,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise ValueError("An identical schedule already exists")

        schedule = Schedule(
            user_id=user_id,
            day_of_week=day_of_week,
            notification_time=notification_time,
            occasion=occasion,
            enabled=enabled,
            notify_day_before=notify_day_before,
        )
        self.db.add(schedule)
        await self.db.flush()
        await self.db.refresh(schedule)
        return schedule

    async def update_schedule(
        self,
        schedule_id: UUID,
        user_id: UUID,
        day_of_week: int | None = None,
        notification_time: time | None = None,
        occasion: str | None = None,
        enabled: bool | None = None,
        notify_day_before: bool | None = None,
    ) -> Schedule | None:
        schedule = await self.get_schedule_by_id(schedule_id, user_id)
        if not schedule:
            return None

        if day_of_week is not None:
            schedule.day_of_week = day_of_week
        if notification_time is not None:
            schedule.notification_time = notification_time
        if occasion is not None:
            schedule.occasion = occasion
        if enabled is not None:
            schedule.enabled = enabled
        if notify_day_before is not None:
            schedule.notify_day_before = notify_day_before

        await self.db.flush()
        await self.db.refresh(schedule)
        return schedule

    async def delete_schedule(self, schedule_id: UUID, user_id: UUID) -> bool:
        schedule = await self.get_schedule_by_id(schedule_id, user_id)
        if not schedule:
            return False

        await self.db.delete(schedule)
        await self.db.flush()
        return True


class NotificationDispatcher:
    def __init__(self, db: AsyncSession, app_url: str):
        self.db = db
        self.app_url = app_url.rstrip("/")

    async def send_outfit_notification(
        self, user_id: UUID, outfit_id: UUID, for_tomorrow: bool = False
    ) -> list[NotificationResult]:
        # Get user (skip deleted users)
        user_result = await self.db.execute(
            select(User).where(User.id == user_id, User.is_active.is_(True))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise ValueError("User not found")

        # Get outfit with items loaded
        outfit_result = await self.db.execute(
            select(Outfit)
            .where(Outfit.id == outfit_id)
            .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
        )
        outfit = outfit_result.scalar_one_or_none()
        if not outfit:
            raise ValueError("Outfit not found")

        # Get enabled channels sorted by priority
        channels_result = await self.db.execute(
            select(NotificationSettings)
            .where(
                and_(
                    NotificationSettings.user_id == user_id,
                    NotificationSettings.enabled == True,  # noqa: E712
                )
            )
            .order_by(NotificationSettings.priority)
        )
        channels = list(channels_result.scalars().all())
        default_channels = await default_channels_for(self.db, user, "daily_outfit")

        if not channels and not default_channels:
            return [
                NotificationResult(
                    channel="none",
                    status=DeliveryStatus.FAILED,
                    error="No notification channels configured",
                )
            ]

        results = await self._send_outfit_default_channels(outfit, user, for_tomorrow)
        success = False

        for channel_config in channels:
            if success:
                break

            result = await self._send_via_channel(channel_config, outfit, user, for_tomorrow)
            results.append(result)

            if result.status == DeliveryStatus.SENT:
                success = True

                # Record notification
                notification = Notification(
                    user_id=user_id,
                    outfit_id=outfit_id,
                    channel=channel_config.channel,
                    status=NotificationStatus.sent,
                    payload={"occasion": outfit.occasion},
                    sent_at=datetime.now(UTC),
                )
                self.db.add(notification)

                # Update outfit status
                outfit.sent_at = datetime.now(UTC)
                outfit.status = "sent"

                await self.db.flush()

        if channels and not success:
            # Record failed notification for retry
            notification = Notification(
                user_id=user_id,
                outfit_id=outfit_id,
                channel=channels[0].channel,
                status=NotificationStatus.retrying,
                payload={"occasion": outfit.occasion},
                attempts=1,
                last_attempt_at=datetime.now(UTC),
                error_message=results[-1].error if results else "Unknown error",
            )
            self.db.add(notification)
            await self.db.flush()

        return results

    def _outfit_push(self, outfit: Outfit, for_tomorrow: bool) -> PushPayload:
        day = "de mañana" if for_tomorrow else "de hoy"
        occasion = occasion_label_es(outfit.occasion)
        weather = outfit.weather_data or {}
        temp = weather.get("temperature")
        title = f"Tu look {day} está listo"
        body = outfit.reasoning or f"Stinky te ha preparado un look {occasion}."
        if temp is not None:
            body = f"{temp}°C · {body}"
        return PushPayload(
            title=title,
            body=body[:180],
            url="/dashboard/history",
            tag=f"daily-outfit-{outfit.id}",
        )

    def _render_outfit_email(self, outfit: Outfit, for_tomorrow: bool, unsubscribe_url: str):
        weather = outfit.weather_data or {}
        highlights: list[str] = []
        if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
            raw = outfit.ai_raw_response.get("highlights", [])
            if isinstance(raw, list):
                highlights = [str(h) for h in raw]
        return render_outfit_email(
            occasion=outfit.occasion,
            reasoning=outfit.reasoning,
            highlights=highlights,
            style_notes=outfit.style_notes,
            temperature=weather.get("temperature") if weather else None,
            condition=str(weather["condition"]) if weather.get("condition") else None,
            for_tomorrow=for_tomorrow,
            cta_url=f"{self.app_url}/dashboard/history",
            unsubscribe_url=unsubscribe_url,
        )

    async def _send_outfit_default_channels(
        self,
        outfit: Outfit,
        user: User,
        for_tomorrow: bool,
        only: list[str] | None = None,
        record: bool = True,
    ) -> list[NotificationResult]:
        """Account email + Web Push for the daily outfit (each recorded separately)."""
        sent = await send_default_channels(
            self.db,
            user=user,
            event="daily_outfit",
            render_email=lambda unsub: self._render_outfit_email(outfit, for_tomorrow, unsub),
            push=self._outfit_push(outfit, for_tomorrow),
            channels=only,
        )
        results: list[NotificationResult] = []
        now = datetime.now(UTC)
        for r in sent:
            status = DeliveryStatus.SENT if r.success else DeliveryStatus.FAILED
            results.append(NotificationResult(channel=r.channel, status=status, error=r.error))
            if record:
                self.db.add(
                    Notification(
                        user_id=user.id,
                        outfit_id=outfit.id,
                        channel=r.channel,
                        status=NotificationStatus.sent
                        if r.success
                        else NotificationStatus.retrying,
                        payload={
                            "type": "daily_outfit",
                            "occasion": outfit.occasion,
                            "for_tomorrow": for_tomorrow,
                        },
                        attempts=1,
                        last_attempt_at=now,
                        sent_at=now if r.success else None,
                        error_message=r.error,
                    )
                )
        if any(r.success for r in sent):
            outfit.sent_at = now
            outfit.status = "sent"
        await self.db.flush()
        return results

    async def retry_notification(self, notification: Notification) -> NotificationResult:
        user_result = await self.db.execute(
            select(User).where(User.id == notification.user_id, User.is_active.is_(True))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return NotificationResult(
                channel=notification.channel,
                status=DeliveryStatus.FAILED,
                error="User not found",
            )

        # Get outfit with items loaded
        outfit_result = await self.db.execute(
            select(Outfit)
            .where(Outfit.id == notification.outfit_id)
            .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
        )
        outfit = outfit_result.scalar_one_or_none()
        if not outfit:
            return NotificationResult(
                channel=notification.channel,
                status=DeliveryStatus.FAILED,
                error="Outfit not found",
            )

        if notification.channel in (CHANNEL_ACCOUNT_EMAIL, CHANNEL_WEB_PUSH):
            payload = notification.payload or {}
            retried = await self._send_outfit_default_channels(
                outfit,
                user,
                bool(payload.get("for_tomorrow")),
                only=[notification.channel],
                record=False,
            )
            if not retried:
                return NotificationResult(
                    channel=notification.channel,
                    status=DeliveryStatus.FAILED,
                    error=f"Channel {notification.channel} disabled or unavailable",
                )
            return retried[0]

        # Get the channel config for this notification's channel
        channel_result = await self.db.execute(
            select(NotificationSettings).where(
                and_(
                    NotificationSettings.user_id == notification.user_id,
                    NotificationSettings.channel == notification.channel,
                    NotificationSettings.enabled == True,  # noqa: E712
                )
            )
        )
        channel_config = channel_result.scalar_one_or_none()
        if not channel_config:
            return NotificationResult(
                channel=notification.channel,
                status=DeliveryStatus.FAILED,
                error=f"Channel {notification.channel} not configured or disabled",
            )

        # Attempt to send
        return await self._send_via_channel(channel_config, outfit, user)

    async def _send_via_channel(
        self,
        channel_config: NotificationSettings,
        outfit: Outfit,
        user: User,
        for_tomorrow: bool = False,
    ) -> NotificationResult:
        try:
            if channel_config.channel == "ntfy":
                provider = NtfyProvider(NtfyConfig(**channel_config.config))
                message = self._build_ntfy_notification(outfit, user, for_tomorrow)
                result = await provider.send(message)

            elif channel_config.channel == "mattermost":
                provider = MattermostProvider(MattermostConfig(**channel_config.config))
                message = self._build_mattermost_message(outfit, user, for_tomorrow)
                result = await provider.send(message)

            elif channel_config.channel == "email":
                provider = EmailProvider(EmailConfig(**channel_config.config))
                message = self._build_email_message(outfit, user, provider.to_address, for_tomorrow)
                result = await provider.send(message)

            elif channel_config.channel == "expo_push":
                provider = ExpoPushProvider(ExpoPushConfig(**channel_config.config))
                message = self._build_expo_push_message(outfit, user, for_tomorrow)
                result = await provider.send(message)

            else:
                return NotificationResult(
                    channel=channel_config.channel,
                    status=DeliveryStatus.FAILED,
                    error=f"Unknown channel: {channel_config.channel}",
                )

            if result.get("success"):
                return NotificationResult(
                    channel=channel_config.channel,
                    status=DeliveryStatus.SENT,
                    response=result,
                )
            else:
                return NotificationResult(
                    channel=channel_config.channel,
                    status=DeliveryStatus.FAILED,
                    error=result.get("error"),
                )

        except Exception as e:
            logger.exception(f"Failed to send via {channel_config.channel}")
            return NotificationResult(
                channel=channel_config.channel,
                status=DeliveryStatus.FAILED,
                error=str(e),
            )

    def _build_ntfy_notification(
        self, outfit: Outfit, user: User, for_tomorrow: bool = False
    ) -> NtfyNotification:
        # Weather info for title
        weather = outfit.weather_data or {}
        temp = weather.get("temperature")
        condition = weather.get("condition", "").lower()

        # Day prefix for messages
        day_label = "manana" if for_tomorrow else "hoy"
        occasion_es = ascii_fold(occasion_label_es(outfit.occasion))

        # Build title with weather (ASCII-safe for HTTP headers, so no accents)
        if temp is not None:
            title = f"Tu look de {day_label}: {occasion_es} - {temp}C"
        else:
            title = f"Tu look de {day_label}: {occasion_es}"

        # Build message body with structured data
        parts = []

        # Add headline if available (stored in reasoning field)
        if outfit.reasoning:
            parts.append(outfit.reasoning)

        # Add highlights from ai_raw_response if available
        highlights = []
        if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
            highlights = outfit.ai_raw_response.get("highlights", [])

        if highlights and isinstance(highlights, list):
            # Format highlights as bullet points
            highlight_lines = [f"* {h}" for h in highlights[:3]]  # Limit to 3
            parts.append("\n".join(highlight_lines))

        # Add styling tip if available
        if outfit.style_notes:
            parts.append(f"Truco: {outfit.style_notes}")

        message = "\n\n".join(parts) if parts else "Stinky ya te ha dejado el look preparado."

        # Choose a single contextual tag based on weather
        tag = "shirt"  # default
        if condition:
            if any(w in condition for w in ["rain", "drizzle", "shower"]):
                tag = "umbrella"
            elif any(w in condition for w in ["sun", "clear"]):
                tag = "sunny"
            elif any(w in condition for w in ["cloud", "overcast"]):
                tag = "cloud"
            elif any(w in condition for w in ["snow", "sleet"]):
                tag = "snowflake"
            elif any(w in condition for w in ["wind"]):
                tag = "wind_face"

        return NtfyNotification(
            topic="",  # Will be set by provider
            title=title,
            message=message,
            tags=[tag],
            priority=3,
            click=f"{self.app_url}/dashboard/history",
        )

    def _build_mattermost_message(
        self, outfit: Outfit, user: User, for_tomorrow: bool = False
    ) -> MattermostMessage:
        weather_text = ""
        if outfit.weather_data:
            weather = outfit.weather_data
            weather_text = f" | {weather.get('temperature', '?')}C {weather.get('condition', '')}"

        day_label = "Tomorrow" if for_tomorrow else "Today"
        greeting = "Good evening" if for_tomorrow else "Good morning"

        # Build message text with structured data
        text_parts = []

        # Add headline (stored in reasoning)
        if outfit.reasoning:
            text_parts.append(f"**{outfit.reasoning}**")

        # Add highlights from ai_raw_response as markdown list
        highlights = []
        if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
            highlights = outfit.ai_raw_response.get("highlights", [])

        if highlights and isinstance(highlights, list):
            highlight_lines = [f"- {h}" for h in highlights[:3]]
            text_parts.append("\n".join(highlight_lines))

        # Add styling tip
        if outfit.style_notes:
            text_parts.append(f"_Tip: {outfit.style_notes}_")

        attachment_text = "\n\n".join(text_parts) if text_parts else "Your outfit is ready!"

        attachment = MattermostAttachment(
            title=f"{day_label}'s Outfit: {outfit.occasion.title()}{weather_text}",
            text=attachment_text,
            color="#3B82F6",
        )

        return MattermostMessage(
            text=f"{greeting}, {user.display_name}! Here's your outfit suggestion for {day_label.lower()}:",
            attachments=[attachment],
        )

    def _build_email_message(
        self, outfit: Outfit, user: User, to: str, for_tomorrow: bool = False
    ) -> EmailMessage:
        weather = outfit.weather_data or {}
        highlights: list[str] = []
        if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
            raw = outfit.ai_raw_response.get("highlights", [])
            if isinstance(raw, list):
                highlights = [str(h) for h in raw]

        rendered = render_outfit_email(
            occasion=outfit.occasion,
            reasoning=outfit.reasoning,
            highlights=highlights,
            style_notes=outfit.style_notes,
            temperature=weather.get("temperature") if weather else None,
            condition=str(weather["condition"]) if weather.get("condition") else None,
            for_tomorrow=for_tomorrow,
            cta_url=f"{self.app_url}/dashboard/history",
        )
        return EmailMessage(
            to=to,
            subject=rendered.subject,
            html_body=rendered.html,
            text_body=rendered.text,
        )

    def _build_expo_push_message(
        self, outfit: Outfit, user: User, for_tomorrow: bool = False
    ) -> ExpoPushMessage:
        weather = outfit.weather_data or {}
        temp = weather.get("temperature")
        day_label = "ma\u00f1ana" if for_tomorrow else "hoy"
        occasion_es = occasion_label_es(outfit.occasion)

        if temp is not None:
            title = f"Tu look de {day_label}: {occasion_es} \u00b7 {temp}\u00b0C"
        else:
            title = f"Tu look de {day_label}: {occasion_es}"

        parts = []
        if outfit.reasoning:
            parts.append(outfit.reasoning)
        if outfit.style_notes:
            parts.append(f"Truco: {outfit.style_notes}")

        body = " \u2022 ".join(parts) if parts else "Stinky ya te ha dejado el look preparado."

        return ExpoPushMessage(
            to="",  # Provider uses its stored token
            title=title,
            body=body,
            data={"outfit_id": str(outfit.id), "screen": "history"},
        )
