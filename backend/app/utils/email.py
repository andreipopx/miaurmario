"""Transactional email via Resend (httpx direct, no SDK), SMTP as fallback."""

import logging

import httpx

from app.config import get_settings
from app.utils.email_templates import (
    RenderedEmail,
    render_magic_link_email,
    render_waitlist_approved_email,
)

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailNotConfiguredError(RuntimeError):
    pass


async def send_magic_link_email(to: str, url: str, *, locale: str | None = None) -> None:
    await _send(to, render_magic_link_email(url, locale=locale))


async def send_waitlist_approved_email(
    to: str, invite_url: str, *, name: str | None = None, locale: str | None = None
) -> None:
    await _send(to, render_waitlist_approved_email(invite_url=invite_url, name=name, locale=locale))


def _smtp_provider(to: str):
    # Imported lazily: notification_providers pulls in the email templates too.
    from app.schemas.notification import EmailConfig
    from app.services.notification_providers import EmailProvider

    provider = EmailProvider(EmailConfig(address=to))
    return provider if provider.is_configured() else None


def email_delivery_available() -> bool:
    """True when notification emails can go out (Resend key or SMTP host+user)."""
    if get_settings().resend_api_key:
        return True
    try:
        return _smtp_provider("probe@example.com") is not None
    except Exception:
        return False


async def send_email(
    to: str, email: RenderedEmail, *, headers: dict[str, str] | None = None
) -> str:
    """Send a notification email through Resend, or SMTP when Resend isn't set.

    Returns the transport used ("resend" / "smtp"). Raises EmailNotConfiguredError
    when neither is configured and RuntimeError when the send fails.
    """
    if get_settings().resend_api_key:
        await _send(to, email, headers=headers)
        return "resend"

    provider = _smtp_provider(to)
    if provider is None:
        raise EmailNotConfiguredError("Neither RESEND_API_KEY nor SMTP is configured")
    from app.services.notification_providers import EmailMessage

    result = await provider.send(
        EmailMessage(
            to=to,
            subject=email.subject,
            html_body=email.html,
            text_body=email.text,
            headers=dict(headers or {}),
        )
    )
    if not result.get("success"):
        raise RuntimeError(f"SMTP send failed: {result.get('error')}")
    return "smtp"


async def _send(to: str, email: RenderedEmail, *, headers: dict[str, str] | None = None) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        raise EmailNotConfiguredError("RESEND_API_KEY not set")

    payload: dict = {
        "from": settings.resend_from_email,
        "to": [to],
        "subject": email.subject,
        "html": email.html,
        "text": email.text,
    }
    if headers:
        payload["headers"] = headers
    request_headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(RESEND_API_URL, json=payload, headers=request_headers)
    if resp.status_code >= 400:
        logger.error("Resend send failed status=%s body=%s", resp.status_code, resp.text)
        raise RuntimeError(f"Resend send failed: {resp.status_code}")
