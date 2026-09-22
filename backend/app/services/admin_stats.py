"""Aggregates for the admin panel (Resumen + Sistema tabs) and the audit helper."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import Date, cast, func, literal_column, select, text, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.admin import AdminAuditLog
from app.models.item import ClothingItem
from app.models.lastfm import LastfmConnection
from app.models.outfit import Outfit
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.models.user_ai_settings import UserAISettings
from app.services.ai_access import current_usage_month
from app.services.app_settings import budget_level, estimate_cost, get_ai_pricing

logger = logging.getLogger(__name__)

WORKER_QUEUE = "arq:tagging"


# --- Audit log ---------------------------------------------------------------------


def audit(
    db: AsyncSession,
    admin: User,
    action: str,
    target_user_id: uuid.UUID | None = None,
    **details: Any,
) -> None:
    """Stage an audit row in the caller's transaction (committed with the mutation)."""
    db.add(
        AdminAuditLog(
            admin_id=admin.id,
            action=action,
            target_user_id=target_user_id,
            details=json.loads(json.dumps(details, default=str)),
        )
    )


# --- Overview ------------------------------------------------------------------------


async def _active_users(db: AsyncSession, since: datetime) -> int:
    """Users with any sign of life since ``since``: login, AI call, new item or outfit."""
    activity = union_all(
        select(User.id.label("uid"), User.last_login_at.label("at")),
        select(UserAISettings.user_id, UserAISettings.last_used_at),
        select(ClothingItem.user_id, ClothingItem.created_at),
        select(Outfit.user_id, Outfit.created_at),
    ).subquery()
    result = await db.execute(
        select(func.count(func.distinct(activity.c.uid))).where(activity.c.at >= since)
    )
    return int(result.scalar_one())


async def _signups_by_day(db: AsyncSession, days: int) -> list[dict[str, Any]]:
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)
    day_col = cast(func.timezone("UTC", User.created_at), Date)
    rows = (
        await db.execute(
            select(day_col.label("day"), func.count(User.id))
            .where(User.created_at >= datetime.combine(start, datetime.min.time(), UTC))
            .group_by(literal_column("day"))
        )
    ).all()
    counts: dict[date, int] = {row[0]: int(row[1]) for row in rows}
    return [
        {
            "date": (start + timedelta(days=i)).isoformat(),
            "count": counts.get(start + timedelta(days=i), 0),
        }
        for i in range(days)
    ]


async def ai_usage_summary(db: AsyncSession, top: int = 5) -> dict[str, Any]:
    month = current_usage_month()
    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(UserAISettings.requests_this_month), 0),
                func.coalesce(func.sum(UserAISettings.tokens_this_month), 0),
                func.coalesce(func.sum(UserAISettings.prompt_tokens_this_month), 0),
                func.coalesce(func.sum(UserAISettings.completion_tokens_this_month), 0),
            ).where(UserAISettings.usage_month == month)
        )
    ).one()
    requests, tokens, prompt, completion = (int(v) for v in totals)
    pricing = await get_ai_pricing(db)
    cost = estimate_cost(pricing, prompt, completion, tokens)

    top_rows = (
        await db.execute(
            select(User.id, User.username, User.display_name, UserAISettings)
            .join(UserAISettings, UserAISettings.user_id == User.id)
            .where(UserAISettings.usage_month == month, UserAISettings.requests_this_month > 0)
            .order_by(
                UserAISettings.tokens_this_month.desc(), UserAISettings.requests_this_month.desc()
            )
            .limit(top)
        )
    ).all()
    top_users = []
    for uid, username, display_name, row in top_rows:
        user_cost = estimate_cost(
            pricing,
            row.prompt_tokens_this_month or 0,
            row.completion_tokens_this_month or 0,
            row.tokens_this_month or 0,
        )
        top_users.append(
            {
                "id": str(uid),
                "username": username,
                "display_name": display_name,
                "ai_access": row.ai_access,
                "requests": row.requests_this_month,
                "tokens": row.tokens_this_month,
                "input_tokens": row.prompt_tokens_this_month,
                "output_tokens": row.completion_tokens_this_month,
                "cost_eur": user_cost.cost_eur,
            }
        )

    return {
        "month": month,
        "requests": requests,
        "tokens": tokens,
        "input_tokens": cost.input_tokens,
        "output_tokens": cost.output_tokens,
        "unsplit_tokens": cost.unsplit_tokens,
        "cost_usd": cost.cost_usd,
        "cost_eur": cost.cost_eur,
        "pricing": pricing.to_dict(),
        "budget_level": budget_level(cost.cost_eur, pricing.monthly_budget_eur),
        "budget_used_pct": (
            round(cost.cost_eur / pricing.monthly_budget_eur * 100, 1)
            if pricing.monthly_budget_eur
            else None
        ),
        "top_users": top_users,
    }


async def overview(db: AsyncSession) -> dict[str, Any]:
    now = datetime.now(UTC)
    total_users = int((await db.execute(select(func.count(User.id)))).scalar_one())
    onboarded = int(
        (
            await db.execute(select(func.count(User.id)).where(User.onboarding_completed.is_(True)))
        ).scalar_one()
    )
    new_7d = int(
        (
            await db.execute(
                select(func.count(User.id)).where(User.created_at >= now - timedelta(days=7))
            )
        ).scalar_one()
    )
    items = int(
        (
            await db.execute(
                select(func.count(ClothingItem.id)).where(ClothingItem.is_archived.is_(False))
            )
        ).scalar_one()
    )
    outfits = int((await db.execute(select(func.count(Outfit.id)))).scalar_one())
    return {
        "users_total": total_users,
        "active_7d": await _active_users(db, now - timedelta(days=7)),
        "active_30d": await _active_users(db, now - timedelta(days=30)),
        "new_7d": new_7d,
        "signups_by_day": await _signups_by_day(db, 14),
        "onboarding_completed": onboarded,
        "onboarding_pct": round(onboarded / total_users * 100, 1) if total_users else 0.0,
        "items_total": items,
        "outfits_total": outfits,
        "ai": await ai_usage_summary(db),
    }


# --- System status ----------------------------------------------------------------------

_DU_TTL = 600.0
_du_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _disk_usage(path: str) -> dict[str, Any]:
    total = 0
    files = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_dir():
                            stack.append(entry.path)
                        elif entry.is_file():
                            files += 1
                            total += entry.stat().st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return {"bytes": total, "files": files}


async def uploads_usage(
    storage_path: str | None = None, *, refresh: bool = False
) -> dict[str, Any]:
    """du of STORAGE_PATH, cached for 10 minutes (walking thousands of photos is slow)."""
    path = storage_path or get_settings().storage_path
    cached = _du_cache.get(path)
    if cached and not refresh and time.monotonic() - cached[0] < _DU_TTL:
        return cached[1]
    if not Path(path).exists():
        result: dict[str, Any] = {"available": False, "bytes": 0, "files": 0}
    else:
        usage = await asyncio.to_thread(_disk_usage, path)
        result = {"available": True, **usage}
    result["computed_at"] = datetime.now(UTC).isoformat()
    _du_cache[path] = (time.monotonic(), result)
    return result


def backup_status() -> dict[str, Any]:
    path = get_settings().backup_status_path
    if not path:
        return {"configured": False}
    p = Path(path)
    try:
        if p.stat().st_size > 64 * 1024:
            return {"configured": True, "ok": False, "error": "file_too_large"}
        data = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"configured": True, "ok": False, "error": "not_found"}
    except (OSError, ValueError):
        return {"configured": True, "ok": False, "error": "unreadable"}
    return {
        "configured": True,
        "ok": True,
        "data": data if isinstance(data, dict) else {"value": data},
    }


async def worker_status() -> dict[str, Any]:
    redis = Redis.from_url(str(get_settings().redis_url), socket_timeout=2)
    try:
        health = await redis.get(f"{WORKER_QUEUE}:health-check")
        ttl_ms = await redis.pttl(f"{WORKER_QUEUE}:health-check") if health else None
        queued = await redis.zcard(WORKER_QUEUE)
    except Exception as exc:
        return {"reachable": False, "alive": False, "error": type(exc).__name__}
    finally:
        await redis.aclose()
    return {
        "reachable": True,
        "alive": health is not None,
        "last_heartbeat": health.decode(errors="replace") if health else None,
        "heartbeat_ttl_ms": ttl_ms,
        "queued": int(queued or 0),
    }


async def system_status(db: AsyncSession) -> dict[str, Any]:
    settings = get_settings()
    db_size = (await db.execute(text("SELECT pg_database_size(current_database())"))).scalar_one()
    spotify_users = int(
        (await db.execute(select(func.count(SpotifyConnection.user_id)))).scalar_one()
    )
    return {
        "version": {"app_version": settings.app_version, "git_sha": settings.git_sha},
        "backup": backup_status(),
        "uploads": await uploads_usage(),
        "database": {"bytes": int(db_size)},
        "worker": await worker_status(),
        "spotify": {
            "configured": bool(settings.spotify_client_id and settings.spotify_client_secret),
            "connected_users": spotify_users,
            "dev_mode_slots": settings.spotify_dev_mode_slots,
        },
        # Aggregate count only (no per-user listening data in the admin panel).
        "lastfm": {
            "configured": bool(settings.lastfm_api_key),
            "connected_users": int(
                (await db.execute(select(func.count(LastfmConnection.user_id)))).scalar_one()
            ),
        },
        "pinterest": {
            "configured": bool(settings.pinterest_client_id and settings.pinterest_client_secret)
        },
    }
