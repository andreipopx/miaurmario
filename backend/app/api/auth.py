import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import DEFAULT_SECRET_KEY, get_settings
from app.database import get_db
from app.models.magic_link import MagicLinkToken
from app.models.user import User
from app.schemas.user import (
    AuthConfigMagicLink,
    AuthConfigOIDC,
    AuthConfigPassword,
    AuthConfigResponse,
    AuthStatusResponse,
    UserResponse,
    UserSyncRequest,
    UserSyncResponse,
)
from app.services.signup import (
    SignupBlockedError,
    authorize_signup,
    check_signup_allowed,
    normalize_invite_code,
)
from app.services.user_service import UserEmailConflictError, UserService
from app.utils.auth import get_current_user
from app.utils.email import send_magic_link_email
from app.utils.oidc import validate_oidc_id_token
from app.utils.passwords import (
    PASSWORD_MAX_LENGTH,
    hash_password_async,
    needs_rehash,
    verify_password_async,
)
from app.utils.rate_limit import (
    _get_client_ip,
    check_rate_limit,
    rate_limit_by_ip,
    rate_limit_by_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()


def create_access_token(external_id: str, expires_delta: timedelta | None = None) -> str:
    """Issue an API access token (HS256, signed with SECRET_KEY).

    Lifetime defaults to ACCESS_TOKEN_DAYS; clients slide it with POST
    /auth/refresh. Rotating SECRET_KEY invalidates every outstanding token.
    """
    now = datetime.now(UTC)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=settings.access_token_days)
    to_encode = {
        "sub": external_id,
        "exp": expire,
        "iat": now,
    }
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def _is_dev_mode() -> bool:
    return settings.debug and settings.secret_key == DEFAULT_SECRET_KEY


def _oidc_configured() -> bool:
    return bool(settings.oidc_issuer_url and settings.oidc_client_id)


def _magic_link_configured() -> bool:
    return bool(settings.resend_api_key)


def require_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    return current_user


MOBILE_APP_SCHEME = "wardrowbe"
MAGIC_LINK_TTL_MINUTES = 15


@router.get("/mobile-callback")
async def mobile_oidc_callback(request: Request) -> RedirectResponse:
    params = dict(request.query_params)
    target = f"{MOBILE_APP_SCHEME}://auth/callback"
    if params:
        target = f"{target}?{urlencode(params)}"
    return RedirectResponse(url=target, status_code=302)


@router.get("/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    oidc_enabled = _oidc_configured()
    return AuthConfigResponse(
        oidc=AuthConfigOIDC(
            enabled=oidc_enabled,
            issuer_url=settings.oidc_issuer_url if oidc_enabled else None,
            client_id=(settings.oidc_mobile_client_id or settings.oidc_client_id)
            if oidc_enabled
            else None,
        ),
        magic_link=AuthConfigMagicLink(enabled=_magic_link_configured()),
        password=AuthConfigPassword(enabled=settings.password_login_enabled),
        dev_mode=_is_dev_mode(),
    )


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status() -> AuthStatusResponse:
    mode = settings.get_auth_mode()
    if mode == "unknown":
        return AuthStatusResponse(
            configured=False,
            mode=mode,
            error=(
                "No authentication method configured. "
                "Set OIDC_ISSUER_URL + OIDC_CLIENT_ID, RESEND_API_KEY (magic link), "
                "or enable DEBUG mode."
            ),
        )
    return AuthStatusResponse(configured=True, mode=mode)


@router.post("/sync", response_model=UserSyncResponse)
async def sync_user(
    request: Request,
    sync_data: UserSyncRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserSyncResponse:
    await rate_limit_by_ip(request, "auth_sync", 10, 60)
    if _is_dev_mode():
        if not sync_data.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="email is required",
            )
    elif _oidc_configured():
        if not sync_data.id_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="OIDC id_token is required for authentication",
            )

        valid_audiences = [settings.oidc_client_id]
        if (
            settings.oidc_mobile_client_id
            and settings.oidc_mobile_client_id != settings.oidc_client_id
        ):
            valid_audiences.append(settings.oidc_mobile_client_id)

        try:
            oidc_claims = await validate_oidc_id_token(
                sync_data.id_token,
                settings.oidc_issuer_url,
                valid_audiences,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(e),
            ) from None

        if oidc_claims.get("sub") != sync_data.external_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token subject does not match external_id",
            )

        claims_email = oidc_claims.get("email", "").lower().strip()
        if sync_data.email:
            request_email = sync_data.email.lower().strip()
            if claims_email and claims_email != request_email:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token email does not match request email",
                )
            effective_email = request_email
        elif claims_email:
            effective_email = claims_email
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No email provided by OIDC provider. Configure your provider to include the email claim.",
            )

        sync_data = sync_data.model_copy(update={"email": effective_email})

        # Check provider migration: different external_id, same email requires verified email
        user_service_check = UserService(db)
        existing_user = await user_service_check.get_by_email(effective_email)
        if existing_user and existing_user.external_id != sync_data.external_id:
            if oidc_claims.get("email_verified") is not True:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email already associated with another account. Verified email required for migration.",
                )
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No authentication method configured",
        )

    user_service = UserService(db)

    # Sign-up gate (invite-only mode) before a new account can be created here.
    if (
        await user_service.get_by_external_id(sync_data.external_id) is None
        and await user_service.get_by_email(sync_data.email or "") is None
    ):
        try:
            await authorize_signup(db, sync_data.email or "", sync_data.invite_code)
        except SignupBlockedError as e:
            await db.rollback()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=e.detail()) from None

    try:
        user, is_new = await user_service.sync_from_oidc(sync_data)
    except UserEmailConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from None

    access_token = create_access_token(user.external_id)

    return UserSyncResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_new_user=is_new,
        onboarding_completed=user.onboarding_completed,
        access_token=access_token,
    )


@router.get("/session", response_model=UserResponse)
async def get_session(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    return UserResponse.model_validate(current_user)


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_access_token(
    current_user: Annotated[User, Depends(get_current_user)],
) -> RefreshResponse:
    """Exchange a still-valid access token for a fresh one (sliding session).

    get_current_user already rejected expired/forged tokens, unknown and
    inactive users, so an expired token can never be revived here. The
    frontend calls this about once a day per active session.
    """
    await rate_limit_by_user(current_user.id, "auth_refresh", 30, 3600)
    return RefreshResponse(
        access_token=create_access_token(current_user.external_id),
        expires_in=settings.access_token_days * 86400,
    )


class MagicLinkRequest(BaseModel):
    email: EmailStr
    # UI language of the page that asked for the link; picks the email copy.
    locale: Literal["es", "en"] | None = None
    # Invite code from /login?invite=CODE; stored on the token and redeemed
    # when the link creates the account.
    invite: str | None = Field(default=None, max_length=64)


class MagicLinkAcceptedResponse(BaseModel):
    status: str = "sent"


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


@router.post(
    "/magic-link/request",
    response_model=MagicLinkAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_magic_link(
    payload: MagicLinkRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MagicLinkAcceptedResponse:
    if not _magic_link_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Magic link auth is not configured",
        )

    await rate_limit_by_ip(request, "magic_link_request", 10, 3600)
    email_l = payload.email.lower().strip()
    await check_rate_limit(f"rate_limit:magic_link_email:{email_l}", 5, 3600)

    user_service = UserService(db)
    user = await user_service.get_by_email(email_l)

    invite_code: str | None = None
    if user is None:
        # Unknown email = would create an account: apply the sign-up gate now so
        # the UI can say "closed beta" instead of emailing a link that fails.
        try:
            await check_signup_allowed(db, email_l, payload.invite)
        except SignupBlockedError as e:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=e.detail()) from None
        try:
            invite_code = normalize_invite_code(payload.invite)
        except SignupBlockedError:
            invite_code = None  # open mode: a malformed code is simply ignored

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    now = datetime.now(UTC)

    db.add(
        MagicLinkToken(
            id=uuid.uuid4(),
            user_id=user.id if user else None,
            email=email_l,
            token_hash=token_hash,
            expires_at=now + timedelta(minutes=MAGIC_LINK_TTL_MINUTES),
            ip_created=_get_client_ip(request),
            invite_code=invite_code,
        )
    )
    await db.commit()

    # Always built from configuration, never from the request Host header:
    # a spoofed Host would otherwise make us email a token-bearing link to an
    # attacker-controlled origin.
    link = f"{settings.magic_link_origin}/auth/callback?token={raw_token}"
    try:
        await send_magic_link_email(email_l, link, locale=payload.locale)
    except Exception as exc:
        logger.exception("Magic link email dispatch failed for %s: %s", email_l, exc)
        # Do NOT reveal failure — still return 202 to avoid email enumeration.

    return MagicLinkAcceptedResponse()


class MagicLinkVerifyRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=512)


class LoginResponse(BaseModel):
    """Token payload shared by every first-party login (magic link, password)."""

    id: uuid.UUID
    external_id: str
    email: str
    display_name: str
    username: str | None = None
    avatar_url: str | None = None
    is_new_user: bool
    onboarding_completed: bool
    needs_username: bool
    access_token: str


# Kept for backwards compatibility with existing imports/tests.
MagicLinkVerifyResponse = LoginResponse


def _login_response(user: User, *, is_new: bool) -> LoginResponse:
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return LoginResponse(
        id=user.id,
        external_id=user.external_id,
        email=user.email,
        display_name=user.display_name,
        username=user.username,
        avatar_url=user.avatar_url,
        is_new_user=is_new,
        onboarding_completed=user.onboarding_completed,
        needs_username=not user.username,
        access_token=create_access_token(user.external_id),
    )


async def _consume_magic_link_token(
    db: AsyncSession, raw_token: str
) -> tuple[str, str | None] | None:
    """Atomically mark a magic-link token as used; return (email, invite_code).

    A single conditional UPDATE ... RETURNING guarantees single use even under
    concurrent requests: only one caller can flip used_at from NULL. Returns
    None when the token is unknown, already used or expired.
    """
    now = datetime.now(UTC)
    result = await db.execute(
        update(MagicLinkToken)
        .where(
            MagicLinkToken.token_hash == _hash_token(raw_token),
            MagicLinkToken.used_at.is_(None),
            MagicLinkToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(MagicLinkToken.email, MagicLinkToken.invite_code)
        .execution_options(synchronize_session=False)
    )
    row = result.first()
    return None if row is None else (row[0], row[1])


@router.post("/magic-link/verify", response_model=MagicLinkVerifyResponse)
async def verify_magic_link(
    payload: MagicLinkVerifyRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MagicLinkVerifyResponse:
    """Consume a magic-link token and return an API access token as JSON.

    Called server-side by the NextAuth `magic-link` credentials provider, which
    turns the result into a NextAuth JWT session (the frontend authenticates
    API calls with session.accessToken, not cookies).
    """
    if not _magic_link_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Magic link auth is not configured",
        )

    await rate_limit_by_ip(request, "magic_link_verify", 20, 900)

    consumed = await _consume_magic_link_token(db, payload.token)
    if consumed is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired link"
        )
    email, invite_code = consumed

    user_service = UserService(db)
    is_new = await user_service.get_by_email(email) is None
    if is_new:
        # Re-check at creation time: the mode or the invite may have changed
        # since the link was requested. The token stays consumed either way.
        try:
            await authorize_signup(db, email, invite_code)
        except SignupBlockedError as e:
            await db.commit()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=e.detail()) from None
    user = await user_service.get_or_create_by_email(email)
    await db.commit()

    return _login_response(user, is_new=is_new)


class PasswordLoginRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=255, description="Email or username")
    password: str = Field(..., min_length=1, max_length=PASSWORD_MAX_LENGTH)


INVALID_CREDENTIALS = "Invalid credentials"


@router.post("/password/login", response_model=LoginResponse)
async def password_login(
    payload: PasswordLoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    """Log in with email-or-username + password (optional, per user).

    Called server-side by the NextAuth `password` credentials provider, which
    forwards the end user's X-Forwarded-For. Unknown identifiers and accounts
    without a password burn one argon2 verification against a dummy hash and
    get the same generic 401, so neither timing nor wording reveals whether an
    account exists or has a password.
    """
    if not settings.password_login_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password login is disabled",
        )

    identifier = payload.identifier.strip().lower()
    await rate_limit_by_ip(request, "password_login", 10, 900)
    ident_key = hashlib.sha256(identifier.encode()).hexdigest()
    await check_rate_limit(f"rate_limit:password_login:ident:{ident_key}", 10, 900)

    user_service = UserService(db)
    user = await user_service.get_by_login_identifier(identifier)
    stored_hash = user.password_hash if user else None

    if not await verify_password_async(stored_hash, payload.password) or user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_CREDENTIALS,
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    if stored_hash and needs_rehash(stored_hash):
        user.password_hash = await hash_password_async(payload.password)
    await user_service.record_login(user)
    await db.commit()

    return _login_response(user, is_new=False)
