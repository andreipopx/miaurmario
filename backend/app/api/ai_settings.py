"""Per-user AI settings: status, bring-your-own-key CRUD and a connection test."""

import base64
import io
import logging
import re
import time
from datetime import UTC, datetime
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.integrations.crypto import IntegrationCryptoError, encrypt_token, encryption_configured
from app.models.user import User
from app.models.user_ai_settings import AI_ACCESS_BYOK, AI_ACCESS_NONE, UserAISettings
from app.services.ai_access import AIAccessError as _AIAccessError
from app.services.ai_access import (
    ProviderURLError,
    _byok_config,
    current_usage_month,
    get_ai_access,
    load_ai_settings,
    make_usage_sink,
    usage_for_current_month,
    validate_provider_url,
)
from app.services.ai_service import (
    AIDisabledError,
    AIProviderConfig,
    AIResponseError,
    AIService,
)
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users/me/ai", tags=["AI settings"])

MODEL_RE = r"^[A-Za-z0-9._:/@+-]{1,100}$"


class ByokInfo(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    vision_model: str | None = None
    text_model: str | None = None
    key_last4: str | None = None
    updated_at: datetime | None = None


class AIUsageInfo(BaseModel):
    month: str
    requests: int
    tokens: int
    last_used_at: datetime | None = None


class AIStatusResponse(BaseModel):
    access: Literal["none", "platform", "byok"]  # effective access
    stored_access: Literal["none", "platform", "byok"]
    is_admin: bool
    byok_configured: bool
    byok: ByokInfo | None = None
    capabilities: dict[str, bool]
    blocked_reason: str | None = None  # e.g. ai_quota_exceeded, ai_key_unreadable
    monthly_request_cap: int | None = None
    usage: AIUsageInfo
    encryption_available: bool
    server_ai_enabled: bool


class ByokUpdateRequest(BaseModel):
    provider: str = Field(default="custom", min_length=1, max_length=50)
    base_url: str = Field(min_length=8, max_length=500)
    # Write-only. Omit (or null) to keep the stored key when only editing models.
    api_key: str | None = Field(default=None, min_length=8, max_length=500)
    vision_model: str | None = Field(default=None, max_length=100)
    text_model: str | None = Field(default=None, max_length=100)

    @field_validator("vision_model", "text_model", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("vision_model", "text_model")
    @classmethod
    def _model_format(cls, v):
        if v is not None and not re.match(MODEL_RE, v):
            raise ValueError("invalid model name")
        return v

    @field_validator("api_key")
    @classmethod
    def _key_format(cls, v):
        if v is None:
            return v
        v = v.strip()
        if any(c.isspace() for c in v) or not v.isprintable():
            raise ValueError("invalid api key")
        return v


class ByokTestRequest(BaseModel):
    """Optional unsaved values to test; missing fields fall back to the saved config."""

    provider: str | None = Field(default=None, max_length=50)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    vision_model: str | None = Field(default=None, max_length=100)
    text_model: str | None = Field(default=None, max_length=100)


class CheckResult(BaseModel):
    ok: bool
    model: str | None = None
    latency_ms: int | None = None
    error: str | None = None
    error_code: str | None = None


class ByokTestResponse(BaseModel):
    ok: bool
    text: CheckResult | None = None
    vision: CheckResult | None = None
    error: str | None = None
    error_code: str | None = None


def _http_error(code: int, error_code: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error_code, "message": message})


async def _status_response(db: AsyncSession, user: User) -> AIStatusResponse:
    access = await get_ai_access(db, user, check_network=False)
    row = access.settings_row
    requests, tokens = usage_for_current_month(row)
    byok_configured = bool(row and row.byok_api_key_ct and row.byok_base_url)
    blocked = access.error.code if isinstance(access.error, _AIAccessError) else None
    if access.effective_access == AI_ACCESS_NONE:
        blocked = None  # "none" is a plan, not a failure
    return AIStatusResponse(
        access=access.effective_access,  # type: ignore[arg-type]
        stored_access=access.stored_access,  # type: ignore[arg-type]
        is_admin=access.is_admin,
        byok_configured=byok_configured,
        byok=ByokInfo(
            provider=row.byok_provider,
            base_url=row.byok_base_url,
            vision_model=row.byok_vision_model,
            text_model=row.byok_text_model,
            key_last4=row.byok_api_key_last4,
            updated_at=row.byok_updated_at,
        )
        if byok_configured and row is not None
        else None,
        capabilities={"vision": access.supports("vision"), "text": access.supports("text")},
        blocked_reason=blocked,
        monthly_request_cap=row.monthly_request_cap if row is not None else None,
        usage=AIUsageInfo(
            month=current_usage_month(),
            requests=requests,
            tokens=tokens,
            last_used_at=row.last_used_at if row is not None else None,
        ),
        encryption_available=encryption_configured(),
        server_ai_enabled=get_settings().ai_enabled,
    )


@router.get("", response_model=AIStatusResponse)
async def get_ai_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> AIStatusResponse:
    return await _status_response(db, current_user)


@router.put("", response_model=AIStatusResponse)
async def put_ai_settings(
    data: ByokUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> AIStatusResponse:
    await rate_limit_by_user(current_user.id, "ai_settings_put", 10, 60)
    if not encryption_configured():
        raise _http_error(
            503,
            "ai_encryption_unavailable",
            "Encryption key not configured on the server; cannot store API keys.",
        )
    if not data.vision_model and not data.text_model:
        raise _http_error(422, "ai_model_required", "Set at least one model.")
    try:
        base_url = await validate_provider_url(data.base_url)
    except ProviderURLError as e:
        raise _http_error(422, f"ai_url_{e.reason}", str(e)) from None

    row = await load_ai_settings(db, current_user.id)
    if row is None:
        row = UserAISettings(user_id=current_user.id, ai_access=AI_ACCESS_NONE)
        db.add(row)

    if data.api_key:
        try:
            row.byok_api_key_ct = encrypt_token(data.api_key)
        except IntegrationCryptoError:
            raise _http_error(
                503, "ai_encryption_unavailable", "Could not encrypt the API key."
            ) from None
        row.byok_api_key_last4 = data.api_key[-4:]
    elif not row.byok_api_key_ct:
        raise _http_error(422, "ai_key_required", "An API key is required.")

    row.byok_provider = data.provider.strip()[:50]
    row.byok_base_url = base_url
    row.byok_vision_model = data.vision_model
    row.byok_text_model = data.text_model
    row.byok_updated_at = datetime.now(UTC)
    row.ai_access = AI_ACCESS_BYOK
    await db.flush()
    await db.commit()
    return await _status_response(db, current_user)


@router.delete("", response_model=AIStatusResponse)
async def delete_ai_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> AIStatusResponse:
    row = await load_ai_settings(db, current_user.id)
    if row is not None:
        row.byok_api_key_ct = None
        row.byok_api_key_last4 = None
        row.byok_provider = None
        row.byok_base_url = None
        row.byok_vision_model = None
        row.byok_text_model = None
        row.byok_updated_at = None
        if row.ai_access == AI_ACCESS_BYOK:
            row.ai_access = AI_ACCESS_NONE
        await db.flush()
        await db.commit()
    return await _status_response(db, current_user)


def _tiny_png_b64() -> str:
    img = Image.new("RGB", (32, 32), (220, 20, 60))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _describe_error(exc: Exception) -> tuple[str, str]:
    """User-facing (message, code) for a failed test call. Never includes the key."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return f"The provider rejected the API key (HTTP {code}).", "ai_test_auth"
        if code == 404:
            return "Model or endpoint not found (HTTP 404). Check the URL and model.", (
                "ai_test_not_found"
            )
        if code == 402:
            return "The provider reports insufficient balance (HTTP 402).", "ai_test_balance"
        if code == 429:
            return "The provider is rate-limiting this key (HTTP 429).", "ai_test_rate_limited"
        return f"The provider returned HTTP {code}.", "ai_test_http"
    if isinstance(exc, httpx.TimeoutException):
        return "The provider did not answer in time.", "ai_test_timeout"
    if isinstance(exc, httpx.RequestError):
        return "Could not connect to the provider.", "ai_test_connect"
    if isinstance(exc, AIResponseError):
        return str(exc), f"ai_test_{exc.reason}"
    return "Unexpected error while testing the provider.", "ai_test_error"


async def _run_check(service: AIService, capability: str) -> CheckResult:
    started = time.monotonic()
    model = service.text_model if capability == "text" else service.vision_model
    try:
        if capability == "text":
            await service.generate_text("Reply with the single word: OK")
        else:
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What colour is this image? One word."},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{_tiny_png_b64()}"},
                        },
                    ],
                }
            ]
            content, err, _ = await service._call_with_fallback(messages, "test", True)
            if not content:
                raise err or AIResponseError("empty response", reason="empty")
    except Exception as e:
        message, code = _describe_error(e)
        logger.info(f"AI connection test ({capability}) failed: {code}")
        return CheckResult(ok=False, model=model, error=message, error_code=code)
    return CheckResult(ok=True, model=model, latency_ms=int((time.monotonic() - started) * 1000))


@router.post("/test", response_model=ByokTestResponse)
async def test_ai_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    data: ByokTestRequest | None = None,
) -> ByokTestResponse:
    await rate_limit_by_user(current_user.id, "ai_settings_test", 5, 60)
    data = data or ByokTestRequest()
    row = await load_ai_settings(db, current_user.id)

    saved: AIProviderConfig | None = None
    if row is not None and row.byok_api_key_ct and row.byok_base_url:
        try:
            saved = _byok_config(row)
        except _AIAccessError as e:
            if not data.api_key:
                return ByokTestResponse(ok=False, error=str(e), error_code=e.code)

    api_key = (data.api_key or "").strip() or (saved.api_key if saved else None)
    base_url = (data.base_url or "").strip() or (saved.base_url if saved else None)
    if not api_key or not base_url:
        return ByokTestResponse(
            ok=False, error="Enter a provider URL and an API key.", error_code="ai_key_required"
        )

    def _model(value: str | None, fallback: str | None) -> str | None:
        if value is None:
            return fallback
        return value.strip() or None

    text_model = _model(data.text_model, saved.text_model if saved else None)
    vision_model = _model(data.vision_model, saved.vision_model if saved else None)
    if not text_model and not vision_model:
        return ByokTestResponse(
            ok=False, error="Set at least one model.", error_code="ai_model_required"
        )

    try:
        base_url = await validate_provider_url(base_url)
    except ProviderURLError as e:
        return ByokTestResponse(ok=False, error=str(e), error_code=f"ai_url_{e.reason}")

    config = AIProviderConfig(
        base_url=base_url,
        api_key=api_key,
        vision_model=vision_model,
        text_model=text_model,
        name="byok-test",
        follow_redirects=False,
    )
    try:
        service = AIService(config=config, usage_sink=make_usage_sink(db, current_user.id))
    except AIDisabledError:
        return ByokTestResponse(
            ok=False, error="AI is disabled on this server.", error_code="ai_server_disabled"
        )
    # One attempt only: a connection test should fail fast, not retry 3x.
    service.settings = service.settings.model_copy(update={"ai_max_retries": 1})
    service.timeout = min(service.timeout, 60)

    text_result = await _run_check(service, "text") if text_model else None
    vision_result = await _run_check(service, "vision") if vision_model else None
    results = [r for r in (text_result, vision_result) if r is not None]
    return ByokTestResponse(ok=all(r.ok for r in results), text=text_result, vision=vision_result)
