"""Runtime settings stored in ``app_settings`` (key -> JSON), edited by site admins.

Env vars provide the defaults; a row in ``app_settings`` overrides them.
Keys:
* ``signup_mode``   -> "open" | "invite_only"   (default "open")
* ``ai_pricing``    -> {input_usd_per_m, output_usd_per_m, usd_eur_rate, monthly_budget_eur}
* ``announcement``  -> {id, text, level, expires_at} | null
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.admin import AppSetting

SignupMode = Literal["open", "invite_only"]
SIGNUP_MODES: tuple[str, ...] = ("open", "invite_only")

KEY_SIGNUP_MODE = "signup_mode"
KEY_AI_PRICING = "ai_pricing"
KEY_ANNOUNCEMENT = "announcement"


async def get_setting(db: AsyncSession, key: str) -> Any:
    row = (await db.execute(select(AppSetting.value).where(AppSetting.key == key))).first()
    return None if row is None else row[0]


async def set_setting(db: AsyncSession, key: str, value: Any, updated_by: uuid.UUID | None) -> None:
    table = AppSetting.__table__
    stmt = pg_insert(table).values(key=key, value=value, updated_by=updated_by)
    stmt = stmt.on_conflict_do_update(
        index_elements=[table.c.key],
        set_={"value": value, "updated_by": updated_by, "updated_at": datetime.now(UTC)},
    )
    await db.execute(stmt)
    if key == KEY_ANNOUNCEMENT:
        invalidate_announcement_cache()


# --- Signup mode ------------------------------------------------------------------


async def get_signup_mode(db: AsyncSession) -> SignupMode:
    value = await get_setting(db, KEY_SIGNUP_MODE)
    return value if value in SIGNUP_MODES else "open"  # type: ignore[return-value]


# --- AI pricing -------------------------------------------------------------------


@dataclass
class AIPricing:
    input_usd_per_m: float
    output_usd_per_m: float
    usd_eur_rate: float
    monthly_budget_eur: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def default_pricing() -> AIPricing:
    s = get_settings()
    return AIPricing(
        input_usd_per_m=s.ai_price_input_usd_per_m,
        output_usd_per_m=s.ai_price_output_usd_per_m,
        usd_eur_rate=s.usd_eur_rate,
        monthly_budget_eur=s.ai_monthly_budget_eur,
    )


async def get_ai_pricing(db: AsyncSession) -> AIPricing:
    pricing = default_pricing()
    stored = await get_setting(db, KEY_AI_PRICING)
    if isinstance(stored, dict):
        for field in ("input_usd_per_m", "output_usd_per_m", "usd_eur_rate"):
            value = stored.get(field)
            if isinstance(value, int | float) and value >= 0:
                setattr(pricing, field, float(value))
        if "monthly_budget_eur" in stored:
            budget = stored.get("monthly_budget_eur")
            pricing.monthly_budget_eur = (
                float(budget) if isinstance(budget, int | float) and budget >= 0 else None
            )
    return pricing


@dataclass
class CostEstimate:
    input_tokens: int
    output_tokens: int
    unsplit_tokens: int
    cost_usd: float
    cost_eur: float


def estimate_cost(
    pricing: AIPricing, prompt_tokens: int, completion_tokens: int, total_tokens: int
) -> CostEstimate:
    """Approximate spend. Tokens recorded without an input/output split (older
    rows, providers that only report a total) are priced at the output rate so
    the estimate errs on the high side."""
    prompt_tokens = max(prompt_tokens, 0)
    completion_tokens = max(completion_tokens, 0)
    unsplit = max(total_tokens - prompt_tokens - completion_tokens, 0)
    usd = (
        prompt_tokens * pricing.input_usd_per_m
        + (completion_tokens + unsplit) * pricing.output_usd_per_m
    ) / 1_000_000
    return CostEstimate(
        input_tokens=prompt_tokens,
        output_tokens=completion_tokens,
        unsplit_tokens=unsplit,
        cost_usd=round(usd, 6),
        cost_eur=round(usd * pricing.usd_eur_rate, 6),
    )


def budget_level(cost_eur: float, budget_eur: float | None) -> Literal["ok", "warning", "exceeded"]:
    if not budget_eur:
        return "ok"
    ratio = cost_eur / budget_eur
    if ratio >= 1:
        return "exceeded"
    if ratio >= 0.8:
        return "warning"
    return "ok"


# --- Announcement (public, cached in-process) ------------------------------------------

_ANNOUNCEMENT_TTL = 30.0
_announcement_cache: tuple[float, dict | None] | None = None


def invalidate_announcement_cache() -> None:
    global _announcement_cache
    _announcement_cache = None


def _active(value: Any, now: datetime) -> dict | None:
    if not isinstance(value, dict) or not value.get("text"):
        return None
    expires = value.get("expires_at")
    if expires:
        try:
            if datetime.fromisoformat(expires) <= now:
                return None
        except ValueError:
            return None
    return value


async def get_active_announcement(db: AsyncSession) -> dict | None:
    global _announcement_cache
    now_mono = time.monotonic()
    if _announcement_cache is not None and now_mono - _announcement_cache[0] < _ANNOUNCEMENT_TTL:
        cached = _announcement_cache[1]
        return _active(cached, datetime.now(UTC))
    value = await get_setting(db, KEY_ANNOUNCEMENT)
    stored = value if isinstance(value, dict) else None
    _announcement_cache = (now_mono, stored)
    return _active(stored, datetime.now(UTC))
