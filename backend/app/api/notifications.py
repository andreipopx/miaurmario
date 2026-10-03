import logging
from datetime import time
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.notification import (
    DEFAULT_CHANNELS,
    NOTIFICATION_EVENTS,
    TIMED_EVENTS,
    NativePushToken,
    Notification,
    PushSubscription,
)
from app.models.user import User
from app.schemas.notification import (
    EventToggles,
    MessageResponse,
    NativePushRegisterRequest,
    NativePushUnregisterRequest,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    NotificationResponse,
    PushSubscribeRequest,
    PushTestResponse,
    PushUnsubscribeRequest,
    ScheduleCreate,
    ScheduleResponse,
    ScheduleUpdate,
    UnsubscribeRequest,
    UnsubscribeResponse,
)
from app.services.event_notifications import get_or_create_preferences, get_preferences
from app.services.native_push import platform_available
from app.services.notification_service import NotificationService
from app.services.push import (
    any_push_available,
    count_push_devices,
    native_platforms_available,
    send_push,
)
from app.services.web_push import PushPayload, push_available
from app.utils.auth import get_current_user
from app.utils.email import email_delivery_available
from app.utils.rate_limit import rate_limit_by_ip, rate_limit_by_user
from app.utils.unsubscribe import UNSUBSCRIBE_ALL, read_unsubscribe_token

logger = logging.getLogger(__name__)

router = APIRouter()


def _parse_local_time(time_str: str) -> time:
    hours, minutes = map(int, time_str.split(":"))
    return time(hours, minutes)


# ============= Schedules =============


@router.get("/schedules", response_model=list[ScheduleResponse])
async def list_schedules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = NotificationService(db)
    schedules = await service.get_user_schedules(current_user.id)
    schedules.sort(key=lambda s: s.day_of_week)
    return schedules


@router.post("/schedules", response_model=ScheduleResponse, status_code=201)
async def create_schedule(
    data: ScheduleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = NotificationService(db)
    try:
        schedule = await service.create_schedule(
            user_id=current_user.id,
            day_of_week=data.day_of_week,
            notification_time=_parse_local_time(data.notification_time),
            occasion=data.occasion,
            enabled=data.enabled,
            notify_day_before=data.notify_day_before,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        ) from None

    await db.commit()
    return schedule


@router.get("/schedules/{schedule_id}", response_model=ScheduleResponse)
async def get_schedule(
    schedule_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = NotificationService(db)
    schedule = await service.get_schedule_by_id(schedule_id, current_user.id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.patch("/schedules/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(
    schedule_id: UUID,
    data: ScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = NotificationService(db)
    patch = data.model_dump(exclude_unset=True)
    raw_notification_time = patch.get("notification_time")
    schedule = await service.update_schedule(
        schedule_id=schedule_id,
        user_id=current_user.id,
        day_of_week=patch.get("day_of_week"),
        notification_time=(
            _parse_local_time(raw_notification_time) if raw_notification_time is not None else None
        ),
        occasion=patch.get("occasion"),
        enabled=patch.get("enabled"),
        notify_day_before=patch.get("notify_day_before"),
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    await db.commit()
    return schedule


@router.delete("/schedules/{schedule_id}", response_model=MessageResponse)
async def delete_schedule(
    schedule_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = NotificationService(db)
    success = await service.delete_schedule(schedule_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule not found")

    await db.commit()
    return MessageResponse(message="Schedule deleted")


# ============= Notification History =============


@router.get("/history", response_model=list[NotificationResponse])
async def list_notification_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


# ============= Default channels: preferences, Web Push, unsubscribe =============


async def _preferences_response(db: AsyncSession, user: User) -> NotificationPreferencesResponse:
    pref = await get_preferences(db, user.id)
    return NotificationPreferencesResponse(
        email=EventToggles(**{e: pref.enabled("email", e) for e in NOTIFICATION_EVENTS}),
        push=EventToggles(**{e: pref.enabled("push", e) for e in NOTIFICATION_EVENTS}),
        email_address=user.email,
        email_available=email_delivery_available(),
        push_available=any_push_available(),
        vapid_public_key=get_settings().vapid_public_key if push_available() else None,
        push_devices=await count_push_devices(db, user.id),
        native_push_platforms=native_platforms_available(),
        morning_look_time=pref.time_for("morning_look"),
        friend_activity_time=pref.time_for("friend_activity"),
    )


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _preferences_response(db, current_user)


@router.patch("/preferences", response_model=NotificationPreferencesResponse)
async def update_notification_preferences(
    data: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pref = await get_or_create_preferences(db, current_user.id)
    for channel in DEFAULT_CHANNELS:
        patch = getattr(data, channel)
        if patch is None:
            continue
        for event, value in patch.model_dump(exclude_none=True).items():
            pref.set(channel, event, value)
    # The two daily alerts also carry the local time they go out at.
    for event in TIMED_EVENTS:
        raw = getattr(data, f"{event}_time", None)
        if raw is not None:
            pref.set_time(event, _parse_local_time(raw))
    await db.commit()
    return await _preferences_response(db, current_user)


@router.post("/push/subscribe", status_code=201)
async def subscribe_push(
    data: PushSubscribeRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not push_available():
        raise HTTPException(status_code=503, detail="push_not_configured")
    await rate_limit_by_user(current_user.id, "push_subscribe", 20, 3600)
    user_agent = (data.user_agent or request.headers.get("user-agent") or "")[:300] or None
    sub = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint))
    ).scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(user_id=current_user.id, endpoint=data.endpoint)
        db.add(sub)
    # A browser endpoint belongs to whoever subscribed last on that device.
    sub.user_id = current_user.id
    sub.p256dh = data.keys.p256dh
    sub.auth = data.keys.auth
    sub.user_agent = user_agent
    await db.commit()
    return {"subscribed": True}


@router.post("/push/unsubscribe")
async def unsubscribe_push(
    data: PushUnsubscribeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == data.endpoint,
            PushSubscription.user_id == current_user.id,
        )
    )
    await db.commit()
    return {"removed": result.rowcount or 0}


@router.post("/push/native/register", status_code=201)
async def register_native_push(
    data: NativePushRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The Android/iOS app hands over the token its OS issued for this install.

    Stored even while the platform's credentials aren't configured yet, so
    installs that already exist start receiving as soon as they are.
    """
    await rate_limit_by_user(current_user.id, "push_native_register", 30, 3600)
    device = (
        await db.execute(select(NativePushToken).where(NativePushToken.token == data.token))
    ).scalar_one_or_none()
    if device is None:
        device = NativePushToken(token=data.token, user_id=current_user.id, platform=data.platform)
        db.add(device)
    # A phone belongs to whoever signed in on it last.
    device.user_id = current_user.id
    device.platform = data.platform
    device.app_version = data.app_version
    await db.commit()
    return {"registered": True, "delivering": platform_available(data.platform)}


@router.post("/push/native/unregister")
async def unregister_native_push(
    data: NativePushUnregisterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        delete(NativePushToken).where(
            NativePushToken.token == data.token,
            NativePushToken.user_id == current_user.id,
        )
    )
    await db.commit()
    return {"removed": result.rowcount or 0}


@router.post("/push/test", response_model=PushTestResponse)
async def test_push(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not any_push_available():
        raise HTTPException(status_code=503, detail="push_not_configured")
    await rate_limit_by_user(current_user.id, "push_test", 5, 60)
    result = await send_push(
        db,
        current_user.id,
        PushPayload(
            title="Miaurmario",
            body="¡Funciona! Stinky ya puede avisarte en este dispositivo.",
            url="/dashboard/notifications",
            tag="push-test",
        ),
        ttl=300,
    )
    await db.commit()
    return PushTestResponse(sent=result.sent, removed=result.removed, failed=result.failed)


async def _apply_unsubscribe(
    db: AsyncSession, token: str | None, *, all_events: bool, resubscribe: bool
) -> UnsubscribeResponse:
    parsed = read_unsubscribe_token(token or "")
    if parsed is None:
        raise HTTPException(status_code=400, detail="invalid_token")
    user_id, scope = parsed
    if all_events:
        scope = UNSUBSCRIBE_ALL
    user = await db.get(User, user_id)
    if user is not None and user.is_active:
        pref = await get_or_create_preferences(db, user_id)
        events = NOTIFICATION_EVENTS if scope == UNSUBSCRIBE_ALL else (scope,)
        for event in events:
            pref.set("email", event, resubscribe)
        await db.commit()
        logger.info(
            "Email %s for user %s scope=%s",
            "resubscribe" if resubscribe else "unsubscribe",
            user_id,
            scope,
        )
    # A deleted account gets the same answer: nothing to leak.
    return UnsubscribeResponse(scope=scope, subscribed=resubscribe)


@router.get("/unsubscribe", include_in_schema=False)
async def unsubscribe_landing(token: str = Query("", max_length=512)):
    """A plain GET on the List-Unsubscribe URL never changes anything (link
    scanners prefetch): it only sends people to the confirmation page."""
    origin = get_settings().magic_link_origin
    return RedirectResponse(f"{origin}/unsubscribe?{urlencode({'token': token})}", status_code=303)


@router.post("/unsubscribe", response_model=UnsubscribeResponse)
async def unsubscribe_email(
    request: Request,
    token: str | None = Query(None, max_length=512),
    db: AsyncSession = Depends(get_db),
):
    """One-click unsubscribe without login. Takes RFC 8058 posts from mail
    clients (token in the query, form body) and JSON from the /unsubscribe page."""
    await rate_limit_by_ip(request, "email_unsubscribe", 30, 60)
    body = UnsubscribeRequest()
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = UnsubscribeRequest.model_validate(await request.json())
        except (ValueError, ValidationError):
            raise HTTPException(status_code=422, detail="invalid_body") from None
    return await _apply_unsubscribe(
        db, body.token or token, all_events=body.all, resubscribe=body.resubscribe
    )
