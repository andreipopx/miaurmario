import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime, time
from enum import StrEnum
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.notification import Notification, NotificationStatus
from app.models.outfit import Outfit, OutfitItem
from app.models.schedule import Schedule
from app.models.user import User
from app.services.event_notifications import (
    CHANNEL_ACCOUNT_EMAIL,
    CHANNEL_WEB_PUSH,
    default_channels_for,
    send_default_channels,
)
from app.services.web_push import PushPayload
from app.utils.email_templates import render_outfit_email
from app.utils.occasions import occasion_label_es
from app.utils.stinky_persona import personalize, stinky_name

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

        if not await default_channels_for(self.db, user, "daily_outfit"):
            return [
                NotificationResult(
                    channel="none",
                    status=DeliveryStatus.FAILED,
                    error="No notification channels configured",
                )
            ]

        return await self._send_outfit_default_channels(outfit, user, for_tomorrow)

    def _outfit_push(
        self, outfit: Outfit, for_tomorrow: bool, user: User | None = None
    ) -> PushPayload:
        day = "de mañana" if for_tomorrow else "de hoy"
        occasion = occasion_label_es(outfit.occasion)
        weather = outfit.weather_data or {}
        temp = weather.get("temperature")
        title = f"Tu look {day} está listo"
        body = outfit.reasoning or f"{stinky_name(user)} te ha preparado un look {occasion}."
        if temp is not None:
            body = f"{temp}°C · {body}"
        return PushPayload(
            title=title,
            body=body[:180],
            url="/dashboard/history",
            tag=f"daily-outfit-{outfit.id}",
        )

    def _render_outfit_email(
        self, outfit: Outfit, for_tomorrow: bool, unsubscribe_url: str, user: User | None = None
    ):
        weather = outfit.weather_data or {}
        highlights: list[str] = []
        if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
            raw = outfit.ai_raw_response.get("highlights", [])
            if isinstance(raw, list):
                highlights = [str(h) for h in raw]
        email = render_outfit_email(
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
        # Signed with their own cat's name (the picture stays Stinky's for now).
        return replace(
            email,
            subject=personalize(email.subject, user),
            html=personalize(email.html, user),
            text=personalize(email.text, user),
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
            render_email=lambda unsub: self._render_outfit_email(outfit, for_tomorrow, unsub, user),
            push=self._outfit_push(outfit, for_tomorrow, user),
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

        if notification.channel not in (CHANNEL_ACCOUNT_EMAIL, CHANNEL_WEB_PUSH):
            # Rows from the old per-user channels (ntfy, Mattermost, ...) can't be resent.
            return NotificationResult(
                channel=notification.channel,
                status=DeliveryStatus.FAILED,
                error=f"Channel {notification.channel} is no longer supported",
            )

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
