"""SMTP transport for outgoing email, and the family invite message."""

import logging
import os
from dataclasses import dataclass, field

from app.utils.email_templates import render_family_invite_email

logger = logging.getLogger(__name__)


@dataclass
class EmailMessage:
    to: str
    subject: str
    html_body: str
    text_body: str = ""
    headers: dict[str, str] = field(default_factory=dict)


class EmailProvider:
    """SMTP transport configured by the operator (SMTP_* env vars)."""

    def __init__(self):
        self.smtp_host = os.getenv("SMTP_HOST")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = os.getenv("SMTP_USER")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
        self.from_name = os.getenv("SMTP_FROM_NAME", "Miaurmario")
        self.from_email = os.getenv("SMTP_FROM_EMAIL", self.smtp_user)

    def is_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_user)

    async def send(self, message: EmailMessage) -> dict:
        if not self.is_configured():
            return {"success": False, "error": "SMTP not configured"}

        try:
            from email.mime.multipart import MIMEMultipart
            from email.mime.text import MIMEText

            import aiosmtplib

            msg = MIMEMultipart("alternative")
            msg["Subject"] = message.subject
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = message.to
            for name, value in message.headers.items():
                msg[name] = value

            if message.text_body:
                msg.attach(MIMEText(message.text_body, "plain"))

            msg.attach(MIMEText(message.html_body, "html"))

            await aiosmtplib.send(
                msg,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_user,
                password=self.smtp_password,
                start_tls=self.smtp_use_tls,
            )
            return {"success": True}
        except ImportError:
            return {"success": False, "error": "aiosmtplib not installed"}
        except Exception as e:
            logger.exception("Email send failed")
            return {"success": False, "error": str(e)}


def build_family_invite_email(
    to: str,
    family_name: str,
    inviter_name: str,
    invite_token: str,
    app_url: str,
    locale: str | None = None,
) -> EmailMessage:
    invite_url = f"{app_url.rstrip('/')}/invite?token={invite_token}"
    rendered = render_family_invite_email(
        inviter_name=inviter_name,
        family_name=family_name,
        invite_url=invite_url,
        locale=locale,
    )
    return EmailMessage(
        to=to, subject=rendered.subject, html_body=rendered.html, text_body=rendered.text
    )
