"""Per-user AI access resolution: free plan (no AI), platform grant, or BYOK.

Every AI entry point (HTTP handlers and arq jobs, which always run on behalf of
one user) goes through this module:

* ``get_ai_access(db, user)`` -> ``ResolvedAIAccess`` describing what the user
  may do (never raises for "none"; used for UI status and "can I auto-tag?").
* ``resolve_ai_client(db, user, capability)`` -> ``AIService | None``.
* ``require_ai_client(db, user, capability)`` -> ``AIService`` or raises an
  ``AIAccessError`` (subclass of ``AIDisabledError``) with a machine code the
  frontend maps (``ai_not_enabled``, ``ai_quota_exceeded`` ...).

Resolution order:
1. Global kill switches (AI_INTERNAL_ENABLED / AI_VISION_ENABLED / AI_TEXT_ENABLED)
   apply to every mode -> plain ``AIDisabledError`` (503, "external agent").
2. Site admins (email in ADMIN_EMAILS) are always "platform".
3. Stored ``user_ai_settings.ai_access`` (missing row == "none").
   * "platform": global env key, subject to ``monthly_request_cap``.
   * "byok": the user's own provider; the key is Fernet-decrypted in memory
     only, and the host is re-checked against private/loopback ranges.

Usage (requests + provider-reported tokens) is recorded per user through an
independent session bound to the caller's engine, so it survives a rollback
of the caller's transaction and never touches its unit of work.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations.crypto import IntegrationCryptoError, decrypt_token
from app.models.user import User
from app.models.user_ai_settings import (
    AI_ACCESS_BYOK,
    AI_ACCESS_NONE,
    AI_ACCESS_PLATFORM,
    UserAISettings,
)
from app.services.ai_service import (
    AIDisabledError,
    AIProviderConfig,
    AIService,
    UsageSink,
    require_internal_ai,
)

logger = logging.getLogger(__name__)

Capability = Literal["vision", "text"]


# --- Errors ------------------------------------------------------------------


class AIAccessError(AIDisabledError):
    """The user is not allowed to use AI for this request (maps to a 4xx + code)."""

    code = "ai_not_enabled"
    http_status = 403

    def __init__(self, message: str | None = None):
        super().__init__(message or self.default_message)

    default_message = "AI is not enabled for this account."


class AINotEnabledError(AIAccessError):
    code = "ai_not_enabled"
    http_status = 403
    default_message = (
        "AI is not enabled for this account. Add your own API key in Settings, "
        "or ask the admin for access."
    )


class AIQuotaExceededError(AIAccessError):
    code = "ai_quota_exceeded"
    http_status = 429
    default_message = "Monthly AI request limit reached for this account."


class AICapabilityUnavailableError(AIAccessError):
    code = "ai_capability_unavailable"
    http_status = 403
    default_message = "Your AI configuration has no model for this feature."


class AIKeyUnreadableError(AIAccessError):
    code = "ai_key_unreadable"
    http_status = 403
    default_message = "Your saved API key could not be read. Please enter it again."


class AIProviderBlockedError(AIAccessError):
    code = "ai_provider_blocked"
    http_status = 403
    default_message = "Your AI provider URL is not allowed."


def ai_error_detail(exc: AIDisabledError) -> tuple[int, dict | str]:
    """HTTP status + detail for an AI access failure (for HTTPException)."""
    if isinstance(exc, AIAccessError):
        return exc.http_status, {"code": exc.code, "message": str(exc)}
    return 503, str(exc)


# --- Site admin ----------------------------------------------------------------


def is_site_admin(user: User) -> bool:
    """ADMIN_EMAILS is the source of truth for site admins.

    ``users.role == "admin"`` alone is NOT sufficient: creating a family also
    sets role="admin" (family admin), so role cannot gate platform features.
    """
    email = (user.email or "").strip().lower()
    return bool(email) and email in get_settings().admin_email_set()


# --- SSRF guard for BYOK base URLs ---------------------------------------------


class ProviderURLError(ValueError):
    """base_url rejected; ``reason`` is a stable code for the frontend."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def normalize_provider_url(url: str) -> tuple[str, str, int]:
    """Syntactic checks. Returns (normalized_url, host, port)."""
    raw = (url or "").strip()
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise ProviderURLError("invalid_url", "Invalid URL") from None
    if parts.scheme.lower() != "https":
        raise ProviderURLError("https_required", "The provider URL must use https://")
    if not parts.hostname:
        raise ProviderURLError("invalid_url", "The provider URL has no host")
    if parts.username or parts.password:
        raise ProviderURLError("invalid_url", "Credentials in the URL are not allowed")
    if parts.query or parts.fragment:
        raise ProviderURLError("invalid_url", "The provider URL must not have a query string")
    host = parts.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise ProviderURLError("private_address", "Local addresses are not allowed")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and not _ip_is_public(literal):
        raise ProviderURLError("private_address", "Private or local addresses are not allowed")
    path = parts.path.rstrip("/")
    netloc = parts.netloc.split("@")[-1]
    normalized = urlunsplit(("https", netloc, path, "", ""))
    return normalized, host, port or 443


async def _resolve_host(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def validate_provider_url(url: str) -> str:
    """Full SSRF check: https only, and every resolved address must be public."""
    normalized, host, port = normalize_provider_url(url)
    try:
        addresses = await asyncio.wait_for(_resolve_host(host, port), timeout=5)
    except (OSError, TimeoutError):
        raise ProviderURLError("unresolvable", "Could not resolve the provider host") from None
    if not addresses:
        raise ProviderURLError("unresolvable", "Could not resolve the provider host")
    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr.split("%")[0])
        except ValueError:
            raise ProviderURLError("private_address", "Unexpected address") from None
        if not _ip_is_public(ip):
            raise ProviderURLError(
                "private_address", "The provider host resolves to a private or local address"
            )
    return normalized


# --- Usage accounting -------------------------------------------------------------


def current_usage_month(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).strftime("%Y-%m")


def usage_for_current_month(row: UserAISettings | None) -> tuple[int, int]:
    """(requests, tokens) for the current UTC month, honouring the lazy reset."""
    if row is None or row.usage_month != current_usage_month():
        return 0, 0
    return row.requests_this_month or 0, row.tokens_this_month or 0


async def record_ai_usage(session: AsyncSession, user_id: UUID, requests: int, tokens: int) -> None:
    """Atomically add usage, resetting counters when the month rolled over."""
    month = current_usage_month()
    table = UserAISettings.__table__
    stmt = pg_insert(table).values(
        user_id=user_id,
        usage_month=month,
        requests_this_month=requests,
        tokens_this_month=tokens,
        last_used_at=datetime.now(UTC),
    )
    same_month = table.c.usage_month == month

    stmt = stmt.on_conflict_do_update(
        index_elements=[table.c.user_id],
        set_={
            "usage_month": month,
            "requests_this_month": case((same_month, table.c.requests_this_month), else_=0)
            + requests,
            "tokens_this_month": case((same_month, table.c.tokens_this_month), else_=0) + tokens,
            "last_used_at": datetime.now(UTC),
        },
    )
    await session.execute(stmt)


def make_usage_sink(db: AsyncSession, user_id: UUID) -> UsageSink:
    """Usage sink writing through an independent session on the caller's engine."""
    bind = db.bind

    async def _sink(requests: int, tokens: int) -> None:
        if bind is None:
            return
        async with AsyncSession(bind=bind, expire_on_commit=False) as session:
            await record_ai_usage(session, user_id, requests, tokens)
            await session.commit()

    return _sink


# --- Resolution -----------------------------------------------------------------


@dataclass
class ResolvedAIAccess:
    stored_access: str  # value in the DB (or "none" when no row)
    effective_access: str  # after admin override / fallbacks
    is_admin: bool
    settings_row: UserAISettings | None
    config: AIProviderConfig | None = None
    # Why AI is not usable right now (None = usable for at least one capability).
    error: AIAccessError | None = None
    server_disabled: bool = False

    def supports(self, capability: Capability) -> bool:
        return self.capability_error(capability) is None

    def capability_error(self, capability: Capability) -> AIDisabledError | None:
        settings = get_settings()
        enabled = (
            settings.effective_ai_vision_enabled
            if capability == "vision"
            else settings.effective_ai_text_enabled
        )
        if not enabled:
            return AIDisabledError(
                f"Internal AI {capability} is disabled; defer this work to an external agent."
            )
        if self.error is not None:
            return self.error
        if self.config is None:
            return AINotEnabledError()
        model = self.config.vision_model if capability == "vision" else self.config.text_model
        if not model:
            return AICapabilityUnavailableError()
        return None


async def load_ai_settings(db: AsyncSession, user_id: UUID) -> UserAISettings | None:
    result = await db.execute(
        select(UserAISettings)
        .where(UserAISettings.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


def _byok_config(row: UserAISettings) -> AIProviderConfig:
    if not row.byok_api_key_ct or not row.byok_base_url:
        raise AINotEnabledError()
    try:
        api_key = decrypt_token(row.byok_api_key_ct)
    except IntegrationCryptoError:
        raise AIKeyUnreadableError() from None
    return AIProviderConfig(
        base_url=row.byok_base_url,
        api_key=api_key,
        vision_model=row.byok_vision_model or None,
        text_model=row.byok_text_model or None,
        name=f"byok:{row.byok_provider or 'custom'}",
        follow_redirects=False,
    )


async def get_ai_access(
    db: AsyncSession, user: User, *, check_network: bool = True
) -> ResolvedAIAccess:
    """Resolve what AI (if any) this user may use. Never raises for access problems."""
    row = await load_ai_settings(db, user.id)
    stored = row.ai_access if row is not None else AI_ACCESS_NONE
    admin = is_site_admin(user)
    effective = AI_ACCESS_PLATFORM if admin and stored != AI_ACCESS_BYOK else stored
    access = ResolvedAIAccess(
        stored_access=stored,
        effective_access=effective,
        is_admin=admin,
        settings_row=row,
        server_disabled=not get_settings().ai_enabled,
    )

    if effective == AI_ACCESS_PLATFORM:
        cap = row.monthly_request_cap if row is not None else None
        requests, _ = usage_for_current_month(row)
        if not admin and cap is not None and requests >= cap:
            access.error = AIQuotaExceededError()
            return access
        access.config = AIProviderConfig.platform()
        return access

    if effective == AI_ACCESS_BYOK and row is not None:
        try:
            config = _byok_config(row)
            if check_network:
                await validate_provider_url(config.base_url)
        except AIAccessError as e:
            access.error = e
            return access
        except ProviderURLError:
            access.error = AIProviderBlockedError()
            return access
        access.config = config
        return access

    access.effective_access = AI_ACCESS_NONE
    access.error = AINotEnabledError()
    return access


def build_ai_service(db: AsyncSession, user: User, access: ResolvedAIAccess) -> AIService:
    assert access.config is not None
    return AIService(config=access.config, usage_sink=make_usage_sink(db, user.id))


async def require_ai_client(db: AsyncSession, user: User, capability: Capability) -> AIService:
    """Return a ready AIService for this user or raise AIDisabledError/AIAccessError.

    The kill-switch check runs before any DB work so the "deferred to external
    agent" contract stays unconditional.
    """
    require_internal_ai(capability)
    access = await get_ai_access(db, user)
    err = access.capability_error(capability)
    if err is not None:
        raise err
    return build_ai_service(db, user, access)


async def resolve_ai_client(
    db: AsyncSession, user: User, capability: Capability
) -> AIService | None:
    """Like require_ai_client but returns None instead of raising."""
    try:
        return await require_ai_client(db, user, capability)
    except AIDisabledError:
        return None
