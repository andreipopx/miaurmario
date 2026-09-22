"""Default notification channels: the account email and Web Push.

Every user gets these without any setup. Which events reach which channel is
decided by ``NotificationPreference`` (no row = everything on); email can also
be switched off per event from the one-click unsubscribe link.

Events: friend request received, friend request accepted, and the scheduled
daily outfit. Deliberately low-noise: reactions never trigger a notification,
and a repeated friend request from the same person is only announced once a day.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.friendship import Friendship, FriendshipStatus
from app.models.notification import (
    Notification,
    NotificationPreference,
    NotificationStatus,
    PushSubscription,
)
from app.models.user import User
from app.services.web_push import PushPayload, push_available, send_web_push
from app.utils.email import email_delivery_available, send_email
from app.utils.email_templates import (
    RenderedEmail,
    render_friend_accepted_email,
    render_friend_request_email,
)
from app.utils.unsubscribe import make_unsubscribe_token

logger = logging.getLogger(__name__)

# Notification.channel values for the default channels (legacy rows use
# "ntfy" / "mattermost" / "email" / "expo_push").
CHANNEL_ACCOUNT_EMAIL = "account_email"
CHANNEL_WEB_PUSH = "web_push"

SOCIAL_DEDUPE_WINDOW = timedelta(hours=24)


def public_origin() -> str:
    """Origin used in links that leave the app (emails, push clicks)."""
    return get_settings().magic_link_origin


def unsubscribe_links(user_id: UUID, event: str) -> tuple[str, str]:
    """(page URL for the email footer, one-click POST URL for List-Unsubscribe)."""
    token = make_unsubscribe_token(user_id, event)
    origin = public_origin()
    return (
        f"{origin}/unsubscribe?token={token}",
        f"{origin}/api/v1/notifications/unsubscribe?token={token}",
    )


async def get_preferences(db: AsyncSession, user_id: UUID) -> NotificationPreference:
    """The user's stored preferences, or an unsaved all-on default."""
    pref = await db.get(NotificationPreference, user_id)
    return pref if pref is not None else NotificationPreference(user_id=user_id)


async def get_or_create_preferences(db: AsyncSession, user_id: UUID) -> NotificationPreference:
    pref = await db.get(NotificationPreference, user_id)
    if pref is None:
        pref = NotificationPreference(
            user_id=user_id,
            email_friend_request=True,
            email_friend_accepted=True,
            email_daily_outfit=True,
            push_friend_request=True,
            push_friend_accepted=True,
            push_daily_outfit=True,
        )
        db.add(pref)
        await db.flush()
    return pref


async def has_push_subscription(db: AsyncSession, user_id: UUID) -> bool:
    result = await db.execute(
        select(PushSubscription.id).where(PushSubscription.user_id == user_id).limit(1)
    )
    return result.first() is not None


async def default_channels_for(db: AsyncSession, user: User, event: str) -> list[str]:
    """Default channels that would carry ``event`` for ``user`` right now."""
    pref = await get_preferences(db, user.id)
    channels: list[str] = []
    if user.email and pref.enabled("email", event) and email_delivery_available():
        channels.append(CHANNEL_ACCOUNT_EMAIL)
    if (
        pref.enabled("push", event)
        and push_available()
        and await has_push_subscription(db, user.id)
    ):
        channels.append(CHANNEL_WEB_PUSH)
    return channels


@dataclass
class DefaultChannelResult:
    channel: str
    success: bool
    error: str | None = None


async def send_default_channels(
    db: AsyncSession,
    *,
    user: User,
    event: str,
    render_email: Callable[[str], RenderedEmail],
    push: PushPayload,
    channels: list[str] | None = None,
) -> list[DefaultChannelResult]:
    """Deliver one event through the default channels enabled for it.

    ``render_email`` receives the unsubscribe page URL. ``channels`` restricts
    delivery (used by retries); by default every enabled channel is used.
    """
    wanted = await default_channels_for(db, user, event)
    if channels is not None:
        wanted = [c for c in wanted if c in channels]

    results: list[DefaultChannelResult] = []
    if CHANNEL_ACCOUNT_EMAIL in wanted:
        page_url, one_click_url = unsubscribe_links(user.id, event)
        headers = {
            "List-Unsubscribe": f"<{one_click_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
        try:
            await send_email(user.email, render_email(page_url), headers=headers)
            results.append(DefaultChannelResult(CHANNEL_ACCOUNT_EMAIL, True))
        except Exception as exc:
            logger.warning("Notification email (%s) to user %s failed: %s", event, user.id, exc)
            results.append(DefaultChannelResult(CHANNEL_ACCOUNT_EMAIL, False, str(exc)))

    if CHANNEL_WEB_PUSH in wanted:
        try:
            pushed = await send_web_push(db, user.id, push)
            if pushed.success:
                results.append(DefaultChannelResult(CHANNEL_WEB_PUSH, True))
            elif pushed.failed:
                results.append(
                    DefaultChannelResult(CHANNEL_WEB_PUSH, False, "; ".join(pushed.errors)[:500])
                )
            # Only expired subscriptions (all removed): nothing to report.
        except Exception as exc:
            logger.warning("Web push (%s) to user %s failed: %s", event, user.id, exc)
            results.append(DefaultChannelResult(CHANNEL_WEB_PUSH, False, str(exc)))
    return results


# --------------------------------------------------------------------------- #
# Social events
# --------------------------------------------------------------------------- #

SOCIAL_EVENTS = ("friend_request", "friend_accepted")


def _social_push(event: str, username: str) -> PushPayload:
    if event == "friend_request":
        return PushPayload(
            title="Nueva solicitud de amistad",
            body=f"@{username} quiere ser tu amigo en Miaurmario",
            url="/dashboard/friends",
            tag=f"friend-request-{username}",
        )
    return PushPayload(
        title="¡Ya sois amigos!",
        body=f"@{username} ha aceptado tu solicitud de amistad",
        url=f"/dashboard/friends/{username}",
        tag=f"friend-accepted-{username}",
    )


async def _recently_notified(
    db: AsyncSession, recipient_id: UUID, event: str, actor_id: UUID
) -> bool:
    since = datetime.now(UTC) - SOCIAL_DEDUPE_WINDOW
    result = await db.execute(
        select(Notification.id)
        .where(
            and_(
                Notification.user_id == recipient_id,
                Notification.payload["type"].astext == event,
                Notification.payload["actor_id"].astext == str(actor_id),
                Notification.created_at >= since,
            )
        )
        .limit(1)
    )
    return result.first() is not None


async def notify_friendship_event(db: AsyncSession, event: str, friendship_id: UUID) -> dict:
    """Announce a friend request (to the addressee) or an acceptance (to the requester).

    Re-checks the friendship state first, so a request cancelled (or a user
    blocked) before the job ran is never announced. Flushes; caller commits.
    """
    if event not in SOCIAL_EVENTS:
        raise ValueError(f"Unknown social event: {event}")

    friendship = (
        await db.execute(
            select(Friendship)
            .where(Friendship.id == friendship_id)
            .options(selectinload(Friendship.requester), selectinload(Friendship.addressee))
        )
    ).scalar_one_or_none()
    if friendship is None:
        return {"status": "skipped", "reason": "friendship_gone"}

    if event == "friend_request":
        if friendship.status != FriendshipStatus.pending:
            return {"status": "skipped", "reason": "not_pending"}
        recipient, actor = friendship.addressee, friendship.requester
    else:
        if friendship.status != FriendshipStatus.accepted:
            return {"status": "skipped", "reason": "not_accepted"}
        recipient, actor = friendship.requester, friendship.addressee

    if not recipient.is_active or not actor.is_active or not actor.username:
        return {"status": "skipped", "reason": "inactive_user"}
    if await _recently_notified(db, recipient.id, event, actor.id):
        return {"status": "skipped", "reason": "duplicate"}

    username = actor.username
    origin = public_origin()
    if event == "friend_request":
        cta_url = f"{origin}/dashboard/friends"

        def render(unsub: str) -> RenderedEmail:
            return render_friend_request_email(
                username=username, cta_url=cta_url, unsubscribe_url=unsub
            )
    else:
        cta_url = f"{origin}/dashboard/friends/{username}"

        def render(unsub: str) -> RenderedEmail:
            return render_friend_accepted_email(
                username=username, cta_url=cta_url, unsubscribe_url=unsub
            )

    results = await send_default_channels(
        db, user=recipient, event=event, render_email=render, push=_social_push(event, username)
    )
    now = datetime.now(UTC)
    for r in results:
        db.add(
            Notification(
                user_id=recipient.id,
                channel=r.channel,
                status=NotificationStatus.sent if r.success else NotificationStatus.failed,
                payload={"type": event, "actor_id": str(actor.id)},
                attempts=1,
                last_attempt_at=now,
                sent_at=now if r.success else None,
                error_message=r.error,
            )
        )
    await db.flush()
    sent = [r.channel for r in results if r.success]
    return {"status": "sent" if sent else "no_channel", "channels": sent}


async def notify_admins_of_waitlist_request(db: AsyncSession, request_id: UUID) -> dict:
    """Email every ADMIN_EMAILS address (+ Web Push to admin accounts) about a new
    waitlist request, so the owner doesn't have to check the admin panel."""
    from sqlalchemy import func

    from app.models.admin import WaitlistRequest
    from app.utils.email_templates import render_waitlist_admin_email

    req = await db.get(WaitlistRequest, request_id)
    if req is None or req.status != "pending":
        return {"status": "skipped", "reason": "not_pending"}

    admins = sorted(get_settings().admin_email_set())
    if not admins:
        return {"status": "skipped", "reason": "no_admins"}

    pending = (
        await db.execute(
            select(func.count())
            .select_from(WaitlistRequest)
            .where(WaitlistRequest.status == "pending")
        )
    ).scalar_one()
    origin = public_origin()
    cta_url = f"{origin}/dashboard/admin?tab=signup"
    email = render_waitlist_admin_email(
        email=req.email,
        name=req.name,
        message=req.message,
        pending=pending,
        cta_url=cta_url,
        origin=origin,
    )
    who = req.name or req.email
    sent: list[str] = []
    for address in admins:
        try:
            await send_email(address, email)
            sent.append(f"email:{address}")
        except Exception as exc:
            logger.warning("Waitlist admin email to %s failed: %s", address, exc)

    if push_available():
        admin_users = (
            await db.execute(select(User).where(func.lower(User.email).in_(admins)))
        ).scalars()
        for admin in admin_users:
            result = await send_web_push(
                db,
                admin.id,
                PushPayload(
                    title="Nueva solicitud de acceso",
                    body=f"{who} quiere entrar en Miaurmario",
                    url="/dashboard/admin?tab=signup",
                    tag="waitlist",
                ),
            )
            if getattr(result, "sent", 0):
                sent.append(f"push:{admin.id}")
    await db.flush()
    return {"status": "sent" if sent else "no_channel", "channels": sent}
