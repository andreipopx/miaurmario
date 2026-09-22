"""Signed one-click unsubscribe tokens for notification emails.

``<payload>.<signature>`` where payload is base64url("<user_id>:<scope>") and the
signature is a truncated HMAC-SHA256 keyed by SECRET_KEY (domain-separated, so
the token can never be confused with a session or image signature). Tokens
don't expire: an unsubscribe link must keep working for as long as the email
sits in someone's inbox. The worst a leaked token can do is turn emails off
(or back on) for that one address.
"""

import base64
import hashlib
import hmac
from uuid import UUID

from app.config import get_settings
from app.models.notification import NOTIFICATION_EVENTS

UNSUBSCRIBE_ALL = "all"
UNSUBSCRIBE_SCOPES = (*NOTIFICATION_EVENTS, UNSUBSCRIBE_ALL)

_DOMAIN = b"miaurmario:unsubscribe:v1"
_SIG_BYTES = 20


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _sign(payload: str) -> str:
    key = hmac.new(get_settings().secret_key.encode(), _DOMAIN, hashlib.sha256).digest()
    return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest()[:_SIG_BYTES])


def make_unsubscribe_token(user_id: UUID, scope: str) -> str:
    if scope not in UNSUBSCRIBE_SCOPES:
        raise ValueError(f"Unknown unsubscribe scope: {scope}")
    payload = _b64(f"{user_id}:{scope}".encode())
    return f"{payload}.{_sign(payload)}"


def read_unsubscribe_token(token: str) -> tuple[UUID, str] | None:
    """(user_id, scope) for a valid token, None otherwise (never raises)."""
    try:
        payload, sig = token.strip().split(".", 1)
        if not hmac.compare_digest(sig, _sign(payload)):
            return None
        user_part, scope = _unb64(payload).decode().split(":", 1)
        if scope not in UNSUBSCRIBE_SCOPES:
            return None
        return UUID(user_part), scope
    except (ValueError, UnicodeDecodeError):
        return None
