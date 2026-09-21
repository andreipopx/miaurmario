"""Site-admin endpoints: list users and grant platform AI.

Admins are defined by ADMIN_EMAILS (see ``is_site_admin``); ``users.role`` is
not editable here, so an admin cannot demote themselves from this API.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import ClothingItem
from app.models.user import User
from app.models.user_ai_settings import (
    AI_ACCESS_BYOK,
    AI_ACCESS_NONE,
    AI_ACCESS_PLATFORM,
    UserAISettings,
)
from app.services.ai_access import is_site_admin, usage_for_current_month
from app.utils.auth import get_current_user

router = APIRouter(prefix="/admin", tags=["Admin"])


def require_site_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not is_site_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "admin_required", "message": "Admin required"},
        )
    return current_user


class AdminUserResponse(BaseModel):
    id: UUID
    username: str | None
    email: str
    display_name: str
    created_at: datetime
    last_login_at: datetime | None
    is_active: bool
    is_admin: bool
    item_count: int
    ai_access: Literal["none", "platform", "byok"]  # stored value
    effective_ai_access: Literal["none", "platform", "byok"]
    byok_configured: bool
    monthly_request_cap: int | None
    requests_this_month: int
    tokens_this_month: int
    last_ai_used_at: datetime | None


class AdminUserListResponse(BaseModel):
    users: list[AdminUserResponse]
    total: int


class AdminUserUpdate(BaseModel):
    ai_access: Literal["none", "platform"] | None = None
    # Explicit null clears the cap; omit the field to leave it unchanged.
    monthly_request_cap: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None


def _to_response(user: User, row: UserAISettings | None, item_count: int) -> AdminUserResponse:
    stored = row.ai_access if row is not None else AI_ACCESS_NONE
    admin = is_site_admin(user)
    effective = AI_ACCESS_PLATFORM if admin and stored != AI_ACCESS_BYOK else stored
    requests, tokens = usage_for_current_month(row)
    return AdminUserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        is_active=user.is_active,
        is_admin=admin,
        item_count=item_count,
        ai_access=stored,  # type: ignore[arg-type]
        effective_ai_access=effective,  # type: ignore[arg-type]
        byok_configured=bool(row and row.byok_api_key_ct),
        monthly_request_cap=row.monthly_request_cap if row is not None else None,
        requests_this_month=requests,
        tokens_this_month=tokens,
        last_ai_used_at=row.last_used_at if row is not None else None,
    )


def _item_count_subquery():
    return (
        select(ClothingItem.user_id, func.count(ClothingItem.id).label("item_count"))
        .where(ClothingItem.is_archived.is_(False))
        .group_by(ClothingItem.user_id)
        .subquery()
    )


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, Depends(require_site_admin)],
    search: str | None = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AdminUserListResponse:
    counts = _item_count_subquery()
    query = (
        select(User, UserAISettings, func.coalesce(counts.c.item_count, 0))
        .outerjoin(UserAISettings, UserAISettings.user_id == User.id)
        .outerjoin(counts, counts.c.user_id == User.id)
        .execution_options(populate_existing=True)
    )
    count_query = select(func.count(User.id))
    if search:
        pattern = f"%{search.strip().lower()}%"
        cond = or_(
            func.lower(User.email).like(pattern),
            func.lower(func.coalesce(User.username, "")).like(pattern),
            func.lower(User.display_name).like(pattern),
        )
        query = query.where(cond)
        count_query = count_query.where(cond)

    total = (await db.execute(count_query)).scalar_one()
    rows = (
        await db.execute(query.order_by(User.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return AdminUserListResponse(
        users=[_to_response(u, s, int(c or 0)) for u, s, c in rows],
        total=total,
    )


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: UUID,
    data: AdminUserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, Depends(require_site_admin)],
) -> AdminUserResponse:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "user_not_found", "message": "User not found"},
        )

    fields = data.model_fields_set
    if "is_active" in fields and data.is_active is False and is_site_admin(target):
        # Covers the admin deactivating themselves by accident.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "cannot_deactivate_admin",
                "message": "Admins cannot be deactivated here (ADMIN_EMAILS is the source of truth).",
            },
        )

    row = (
        await db.execute(
            select(UserAISettings)
            .where(UserAISettings.user_id == target.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    needs_row = ("ai_access" in fields and data.ai_access is not None) or (
        "monthly_request_cap" in fields
    )
    if row is None and needs_row:
        row = UserAISettings(user_id=target.id, ai_access=AI_ACCESS_NONE)
        db.add(row)

    if "ai_access" in fields and data.ai_access is not None and row is not None:
        if data.ai_access == AI_ACCESS_NONE and row.ai_access == AI_ACCESS_BYOK:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "user_uses_own_key",
                    "message": "This user uses their own API key; there is no grant to revoke.",
                },
            )
        row.ai_access = data.ai_access
    if "monthly_request_cap" in fields and row is not None:
        row.monthly_request_cap = data.monthly_request_cap
    if "is_active" in fields and data.is_active is not None:
        target.is_active = data.is_active

    await db.flush()
    await db.commit()

    counts = (
        await db.execute(
            select(func.count(ClothingItem.id)).where(
                ClothingItem.user_id == target.id, ClothingItem.is_archived.is_(False)
            )
        )
    ).scalar_one()
    return _to_response(target, row, int(counts or 0))
