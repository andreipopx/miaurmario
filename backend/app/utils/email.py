"""Transactional email via Resend (httpx direct, no SDK)."""

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


async def _send(to: str, email: RenderedEmail) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        raise EmailNotConfiguredError("RESEND_API_KEY not set")

    payload = {
        "from": settings.resend_from_email,
        "to": [to],
        "subject": email.subject,
        "html": email.html,
        "text": email.text,
    }
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(RESEND_API_URL, json=payload, headers=headers)
    if resp.status_code >= 400:
        logger.error("Resend send failed status=%s body=%s", resp.status_code, resp.text)
        raise RuntimeError(f"Resend send failed: {resp.status_code}")
