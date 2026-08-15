"""Transactional email via Resend (httpx direct, no SDK)."""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailNotConfiguredError(RuntimeError):
    pass


def _magic_link_html(url: str) -> str:
    return f"""<!doctype html>
<html lang="es">
<body style="font-family: Georgia, 'Playfair Display', serif; background:#F5EFE6; color:#2b1e1e; margin:0; padding:32px;">
  <div style="max-width:520px; margin:0 auto; background:#fff; padding:40px 32px;">
    <h1 style="font-family:'Playfair Display',Georgia,serif; font-style:italic; color:#7B1E1E; font-size:28px; margin:0 0 24px;">Miaurmario</h1>
    <p style="font-size:16px; line-height:1.6;">Alguien &mdash;ojal&aacute; t&uacute;&mdash; pidi&oacute; entrar a Miaurmario con este correo.</p>
    <p style="font-size:14px; line-height:1.6; color:#555;">Este enlace caduca en 15 minutos y solo funciona una vez.</p>
    <p style="margin:32px 0;">
      <a href="{url}" style="display:inline-block; background:#7B1E1E; color:#F5EFE6; text-decoration:none; padding:14px 28px; font-family:Georgia,serif; letter-spacing:0.05em; text-transform:uppercase; font-size:13px;">Entrar en Miaurmario</a>
    </p>
    <p style="font-size:12px; color:#888; line-height:1.5;">Si no fuiste t&uacute;, ignora este mensaje. Nadie podr&aacute; acceder a tu cuenta sin este enlace.</p>
  </div>
</body>
</html>"""


def _magic_link_text(url: str) -> str:
    return (
        "Alguien —ojalá tú— pidió entrar a Miaurmario con este correo.\n"
        "Este enlace caduca en 15 minutos y solo funciona una vez.\n\n"
        f"Entrar: {url}\n\n"
        "Si no fuiste tú, ignora este mensaje."
    )


async def send_magic_link_email(to: str, url: str) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        raise EmailNotConfiguredError("RESEND_API_KEY not set")

    payload = {
        "from": settings.resend_from_email,
        "to": [to],
        "subject": "Tu enlace de acceso a Miaurmario",
        "html": _magic_link_html(url),
        "text": _magic_link_text(url),
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
