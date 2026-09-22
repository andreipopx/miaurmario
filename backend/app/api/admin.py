"""Site-admin endpoints: users (list, detail, AI grant, activation, password
removal, GDPR deletion).

Admins are defined by ADMIN_EMAILS (see ``is_site_admin``); ``users.role`` is
not editable here, so an admin cannot demote themselves from this API. Every
mutation writes an ``admin_audit_log`` row in the same transaction.

Privacy: no endpoint here exposes a user's wardrobe, outfits or photos; only
counts.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from arq import create_pool
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import AccountDeletion
from app.models.item import ClothingItem
from app.models.lastfm import LastfmConnection
from app.models.outfit import Outfit
from app.models.pinterest import PinterestConnection
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.models.user_ai_settings import (
    AI_ACCESS_BYOK,
    AI_ACCESS_NONE,
    AI_ACCESS_PLATFORM,
    UserAISettings,
)
from app.services.account_deletion import email_sha256
from app.services.admin_stats import audit
from app.services.ai_access import (
    is_site_admin,
    token_split_for_current_month,
    usage_for_current_month,
)
from app.services.app_settings import estimate_cost, get_ai_pricing
from app.utils.auth import get_current_user
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)

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

    changes: dict = {}
    if "ai_access" in fields and data.ai_access is not None and row is not None:
        if data.ai_access == AI_ACCESS_NONE and row.ai_access == AI_ACCESS_BYOK:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "user_uses_own_key",
                    "message": "This user uses their own API key; there is no grant to revoke.",
                },
            )
        if row.ai_access != data.ai_access:
            changes["ai_access"] = {"from": row.ai_access, "to": data.ai_access}
        row.ai_access = data.ai_access
    if "monthly_request_cap" in fields and row is not None:
        if row.monthly_request_cap != data.monthly_request_cap:
            changes["monthly_request_cap"] = {
                "from": row.monthly_request_cap,
                "to": data.monthly_request_cap,
            }
        row.monthly_request_cap = data.monthly_request_cap
    if "is_active" in fields and data.is_active is not None:
        if target.is_active != data.is_active:
            changes["is_active"] = {"from": target.is_active, "to": data.is_active}
        target.is_active = data.is_active

    if changes:
        audit(db, _admin, "user.update", target.id, **changes)
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


# --- User detail ------------------------------------------------------------------------


class AdminUserDetail(AdminUserResponse):
    onboarding_completed: bool
    has_password: bool
    outfit_count: int
    # None when the friends feature (``friendships`` table) is not installed.
    friend_count: int | None
    # Connection flags only: admins never see individual listening data.
    spotify_connected: bool
    lastfm_connected: bool
    pinterest_connected: bool
    input_tokens_this_month: int
    output_tokens_this_month: int
    cost_eur_this_month: float
    deletion_status: str | None


async def _get_target(db: AsyncSession, user_id: UUID) -> User:
    target = await db.get(User, user_id, populate_existing=True)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "user_not_found", "message": "User not found"},
        )
    return target


async def _table_exists(db: AsyncSession, name: str) -> bool:
    result = await db.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{name}"})
    return result.scalar_one() is not None


async def _friend_count(db: AsyncSession, user_id: UUID) -> int | None:
    """Accepted friendships, only when the friends feature is installed."""
    if not await _table_exists(db, "friendships"):
        return None
    try:
        async with db.begin_nested():
            result = await db.execute(
                text(
                    "SELECT count(*) FROM friendships "
                    "WHERE (requester_id = :uid OR addressee_id = :uid) "
                    "AND status::text = 'accepted'"
                ),
                {"uid": user_id},
            )
            return int(result.scalar_one())
    except Exception:  # unexpected schema: report "unknown" rather than fail the page
        logger.warning("friendships table present but not countable")
        return None


async def _count(db: AsyncSession, stmt) -> int:
    return int((await db.execute(stmt)).scalar_one() or 0)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, Depends(require_site_admin)],
) -> AdminUserDetail:
    target = await _get_target(db, user_id)
    row = (
        await db.execute(
            select(UserAISettings)
            .where(UserAISettings.user_id == target.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    items = await _count(
        db,
        select(func.count(ClothingItem.id)).where(
            ClothingItem.user_id == target.id, ClothingItem.is_archived.is_(False)
        ),
    )
    outfits = await _count(db, select(func.count(Outfit.id)).where(Outfit.user_id == target.id))
    spotify = await _count(
        db, select(func.count(SpotifyConnection.id)).where(SpotifyConnection.user_id == target.id)
    )
    lastfm = await _count(
        db, select(func.count(LastfmConnection.id)).where(LastfmConnection.user_id == target.id)
    )
    pinterest = await _count(
        db,
        select(func.count(PinterestConnection.id)).where(PinterestConnection.user_id == target.id),
    )
    deletion = (
        await db.execute(
            select(AccountDeletion.status)
            .where(AccountDeletion.user_id == target.id)
            .order_by(AccountDeletion.requested_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    prompt, completion = token_split_for_current_month(row)
    _, tokens = usage_for_current_month(row)
    cost = estimate_cost(await get_ai_pricing(db), prompt, completion, tokens)

    base = _to_response(target, row, items)
    return AdminUserDetail(
        **base.model_dump(),
        onboarding_completed=bool(target.onboarding_completed),
        has_password=bool(target.password_hash),
        outfit_count=outfits,
        friend_count=await _friend_count(db, target.id),
        spotify_connected=spotify > 0,
        lastfm_connected=lastfm > 0,
        pinterest_connected=pinterest > 0,
        input_tokens_this_month=prompt,
        output_tokens_this_month=completion,
        cost_eur_this_month=cost.cost_eur,
        deletion_status=deletion,
    )


# --- Password removal ---------------------------------------------------------------------


@router.delete("/users/{user_id}/password", response_model=AdminUserDetail)
async def remove_user_password(
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(require_site_admin)],
) -> AdminUserDetail:
    """Drop the user's password: they can only sign in with a magic link again."""
    target = await _get_target(db, user_id)
    if target.password_hash:
        target.password_hash = None
        target.password_updated_at = datetime.now(UTC)
        audit(db, admin, "user.password_removed", target.id)
        await db.commit()
    return await get_user_detail(user_id, db, admin)


# --- GDPR account deletion -------------------------------------------------------------------


class DeleteAccountRequest(BaseModel):
    # The username (or the email for accounts without one), typed by the admin.
    confirm: str = Field(..., min_length=1, max_length=255)


class AccountDeletionResponse(BaseModel):
    id: UUID
    user_id: UUID
    username: str | None
    status: str
    error: str | None
    summary: dict
    requested_at: datetime
    completed_at: datetime | None


async def enqueue_account_deletion(deletion_id: UUID) -> None:
    redis = await create_pool(get_redis_settings())
    try:
        await redis.enqueue_job(
            "delete_user_account",
            str(deletion_id),
            _queue_name="arq:tagging",
        )
    finally:
        await redis.aclose()


@router.post(
    "/users/{user_id}/delete",
    response_model=AccountDeletionResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_account_deletion(
    user_id: UUID,
    data: DeleteAccountRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(require_site_admin)],
) -> AccountDeletionResponse:
    target = await _get_target(db, user_id)
    if target.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "cannot_delete_self", "message": "You cannot delete your own account."},
        )
    if is_site_admin(target):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "cannot_delete_admin", "message": "Site admins cannot be deleted."},
        )
    expected = (target.username or target.email).strip().lower()
    if data.confirm.strip().lstrip("@").lower() != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "confirm_mismatch", "message": "Confirmation does not match."},
        )

    deletion = AccountDeletion(
        user_id=target.id,
        username=target.username,
        email_sha256=email_sha256(target.email),
        requested_by=admin.id,
        status="pending",
        summary={},
    )
    db.add(deletion)
    # Lock the account right away; the worker removes it shortly after.
    target.is_active = False
    await db.flush()
    audit(
        db,
        admin,
        "user.delete_requested",
        target.id,
        deletion_id=str(deletion.id),
        username=target.username,
    )
    await db.commit()

    try:
        await enqueue_account_deletion(deletion.id)
    except Exception as exc:
        logger.exception("Could not enqueue account deletion %s", deletion.id)
        deletion.status = "failed"
        deletion.error = f"enqueue: {type(exc).__name__}"
        await db.commit()
    await db.refresh(deletion)
    return AccountDeletionResponse.model_validate(deletion, from_attributes=True)


@router.get("/deletions", response_model=list[AccountDeletionResponse])
async def list_account_deletions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, Depends(require_site_admin)],
    limit: int = Query(50, ge=1, le=200),
) -> list[AccountDeletionResponse]:
    rows = (
        await db.execute(
            select(AccountDeletion)
            .order_by(AccountDeletion.requested_at.desc())
            .limit(limit)
            .execution_options(populate_existing=True)
        )
    ).scalars()
    return [AccountDeletionResponse.model_validate(r, from_attributes=True) for r in rows]


@router.post("/deletions/{deletion_id}/retry", response_model=AccountDeletionResponse)
async def retry_account_deletion(
    deletion_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(require_site_admin)],
) -> AccountDeletionResponse:
    deletion = await db.get(AccountDeletion, deletion_id, populate_existing=True)
    if deletion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if deletion.status != "failed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "not_failed", "message": "Only failed deletions can be retried."},
        )
    deletion.status = "pending"
    deletion.error = None
    audit(db, admin, "user.delete_retried", deletion.user_id, deletion_id=str(deletion.id))
    await db.commit()
    try:
        await enqueue_account_deletion(deletion.id)
    except Exception as exc:
        deletion.status = "failed"
        deletion.error = f"enqueue: {type(exc).__name__}"
        await db.commit()
    await db.refresh(deletion)
    return AccountDeletionResponse.model_validate(deletion, from_attributes=True)
