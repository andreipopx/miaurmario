"""Site-admin panel: overview, AI cost settings, sign-up mode, invites and waitlist,
feedback inbox, system status, global announcement and the audit log.

Every endpoint requires a site admin (ADMIN_EMAILS); every mutation writes an
``admin_audit_log`` row in the same transaction.
"""

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import require_site_admin
from app.config import get_settings
from app.database import get_db
from app.models.admin import AdminAuditLog, FeedbackReport, InviteCode, WaitlistRequest
from app.models.user import User
from app.services import app_settings as app_cfg
from app.services.admin_stats import audit, overview, system_status, uploads_usage
from app.services.signup import generate_invite_code
from app.utils.email import send_waitlist_approved_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

AdminUser = Annotated[User, Depends(require_site_admin)]
DB = Annotated[AsyncSession, Depends(get_db)]


# --- Overview ---------------------------------------------------------------------------


@router.get("/overview")
async def get_overview(db: DB, _admin: AdminUser) -> dict[str, Any]:
    return await overview(db)


# --- AI pricing / budget --------------------------------------------------------------------


class AIPricingPayload(BaseModel):
    input_usd_per_m: float = Field(..., ge=0, le=1000)
    output_usd_per_m: float = Field(..., ge=0, le=1000)
    usd_eur_rate: float = Field(..., gt=0, le=10)
    monthly_budget_eur: float | None = Field(default=None, ge=0, le=1_000_000)


@router.get("/settings/ai-pricing")
async def get_ai_pricing(db: DB, _admin: AdminUser) -> dict[str, Any]:
    return (await app_cfg.get_ai_pricing(db)).to_dict()


@router.put("/settings/ai-pricing")
async def put_ai_pricing(data: AIPricingPayload, db: DB, admin: AdminUser) -> dict[str, Any]:
    before = (await app_cfg.get_ai_pricing(db)).to_dict()
    value = data.model_dump()
    await app_cfg.set_setting(db, app_cfg.KEY_AI_PRICING, value, admin.id)
    audit(db, admin, "settings.ai_pricing", before=before, after=value)
    await db.commit()
    return (await app_cfg.get_ai_pricing(db)).to_dict()


# --- Sign-up mode & invites ----------------------------------------------------------------


class SignupModePayload(BaseModel):
    mode: Literal["open", "invite_only"]


@router.get("/signup")
async def get_signup(db: DB, _admin: AdminUser) -> dict[str, Any]:
    return {"mode": await app_cfg.get_signup_mode(db)}


@router.put("/signup")
async def put_signup(data: SignupModePayload, db: DB, admin: AdminUser) -> dict[str, Any]:
    before = await app_cfg.get_signup_mode(db)
    await app_cfg.set_setting(db, app_cfg.KEY_SIGNUP_MODE, data.mode, admin.id)
    if before != data.mode:
        audit(db, admin, "settings.signup_mode", before=before, after=data.mode)
    await db.commit()
    return {"mode": data.mode}


class InviteCreate(BaseModel):
    note: str | None = Field(default=None, max_length=200)
    max_uses: int | None = Field(default=None, ge=1, le=10_000)
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def _future(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        if v <= datetime.now(UTC):
            raise ValueError("expires_at must be in the future")
        return v


class InviteResponse(BaseModel):
    id: UUID
    code: str
    note: str | None
    max_uses: int | None
    uses: int
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    status: Literal["active", "revoked", "expired", "used_up"]
    link: str
    email: str | None = None


def _invite_response(invite: InviteCode) -> InviteResponse:
    now = datetime.now(UTC)
    if invite.revoked_at is not None:
        state = "revoked"
    elif invite.expires_at is not None and invite.expires_at <= now:
        state = "expired"
    elif invite.max_uses is not None and invite.uses >= invite.max_uses:
        state = "used_up"
    else:
        state = "active"
    origin = get_settings().magic_link_origin
    return InviteResponse(
        id=invite.id,
        code=invite.code,
        note=invite.note,
        max_uses=invite.max_uses,
        uses=invite.uses,
        expires_at=invite.expires_at,
        revoked_at=invite.revoked_at,
        created_at=invite.created_at,
        status=state,  # type: ignore[arg-type]
        link=f"{origin}/login?invite={invite.code}",
        email=invite.email,
    )


@router.get("/invites", response_model=list[InviteResponse])
async def list_invites(db: DB, _admin: AdminUser) -> list[InviteResponse]:
    rows = (
        await db.execute(
            select(InviteCode)
            .order_by(InviteCode.created_at.desc())
            .execution_options(populate_existing=True)
        )
    ).scalars()
    return [_invite_response(r) for r in rows]


@router.post("/invites", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
async def create_invite(data: InviteCreate, db: DB, admin: AdminUser) -> InviteResponse:
    for _ in range(5):
        code = generate_invite_code()
        exists = (
            await db.execute(select(InviteCode.id).where(InviteCode.code == code))
        ).scalar_one_or_none()
        if exists is None:
            break
    else:  # pragma: no cover - 32^10 space
        raise HTTPException(status_code=500, detail="Could not generate a unique code")
    invite = InviteCode(
        id=uuid4(),
        code=code,
        note=data.note,
        max_uses=data.max_uses,
        expires_at=data.expires_at,
        created_by=admin.id,
    )
    db.add(invite)
    audit(
        db,
        admin,
        "invite.create",
        code=code,
        max_uses=data.max_uses,
        expires_at=data.expires_at,
        note=data.note,
    )
    await db.commit()
    await db.refresh(invite)
    return _invite_response(invite)


@router.post("/invites/{invite_id}/revoke", response_model=InviteResponse)
async def revoke_invite(invite_id: UUID, db: DB, admin: AdminUser) -> InviteResponse:
    invite = await db.get(InviteCode, invite_id, populate_existing=True)
    if invite is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.revoked_at is None:
        invite.revoked_at = datetime.now(UTC)
        audit(db, admin, "invite.revoke", code=invite.code)
        await db.commit()
        await db.refresh(invite)
    return _invite_response(invite)


# --- Waitlist -----------------------------------------------------------------------------

WAITLIST_INVITE_DAYS = 14


class WaitlistItem(BaseModel):
    id: UUID
    email: str
    name: str | None
    message: str | None
    locale: str
    status: Literal["pending", "approved", "rejected"]
    created_at: datetime
    decided_at: datetime | None
    invite_code: str | None = None


class WaitlistListResponse(BaseModel):
    items: list[WaitlistItem]
    pending_count: int


class WaitlistDecision(BaseModel):
    ids: list[UUID] = Field(..., min_length=1, max_length=100)
    action: Literal["approve", "reject"]


class WaitlistDecisionResult(BaseModel):
    approved: int = 0
    rejected: int = 0
    skipped: int = 0
    emails_failed: int = 0


async def _pending_waitlist_count(db: AsyncSession) -> int:
    return int(
        (
            await db.execute(
                select(func.count(WaitlistRequest.id)).where(WaitlistRequest.status == "pending")
            )
        ).scalar_one()
    )


async def _unique_invite_code(db: AsyncSession) -> str:
    for _ in range(5):
        code = generate_invite_code()
        exists = (
            await db.execute(select(InviteCode.id).where(InviteCode.code == code))
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise HTTPException(
        status_code=500, detail="Could not generate a unique code"
    )  # pragma: no cover


@router.get("/waitlist", response_model=WaitlistListResponse)
async def list_waitlist(
    db: DB,
    _admin: AdminUser,
    status_filter: Literal["pending", "approved", "rejected"] | None = Query(
        "pending", alias="status"
    ),
    limit: int = Query(100, ge=1, le=500),
) -> WaitlistListResponse:
    query = select(WaitlistRequest, InviteCode.code).outerjoin(
        InviteCode, InviteCode.id == WaitlistRequest.invite_id
    )
    if status_filter:
        query = query.where(WaitlistRequest.status == status_filter)
    order = (
        WaitlistRequest.created_at.asc()
        if status_filter == "pending"
        else WaitlistRequest.created_at.desc()
    )
    rows = (
        await db.execute(
            query.order_by(order).limit(limit).execution_options(populate_existing=True)
        )
    ).all()
    return WaitlistListResponse(
        items=[
            WaitlistItem(
                id=w.id,
                email=w.email,
                name=w.name,
                message=w.message,
                locale=w.locale,
                status=w.status,  # type: ignore[arg-type]
                created_at=w.created_at,
                decided_at=w.decided_at,
                invite_code=code,
            )
            for w, code in rows
        ],
        pending_count=await _pending_waitlist_count(db),
    )


@router.post("/waitlist/decide", response_model=WaitlistDecisionResult)
async def decide_waitlist(
    data: WaitlistDecision, db: DB, admin: AdminUser
) -> WaitlistDecisionResult:
    """Approve (single-use invite bound to the email, 14 days, emailed) or reject
    (no email) pending requests, in bulk. Already-decided rows are skipped."""
    rows = (
        (
            await db.execute(
                select(WaitlistRequest)
                .where(WaitlistRequest.id.in_(data.ids))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    result = WaitlistDecisionResult(skipped=len(set(data.ids)) - len(rows))
    now = datetime.now(UTC)
    to_email: list[tuple[str, str, str | None, str]] = []
    origin = get_settings().magic_link_origin
    for req in rows:
        if req.status != "pending":
            result.skipped += 1
            continue
        req.decided_at = now
        req.decided_by = admin.id
        if data.action == "reject":
            req.status = "rejected"
            result.rejected += 1
            audit(db, admin, "waitlist.reject", request_id=str(req.id))
            continue
        code = await _unique_invite_code(db)
        invite = InviteCode(
            id=uuid4(),
            code=code,
            note="Lista de espera",
            max_uses=1,
            expires_at=now + timedelta(days=WAITLIST_INVITE_DAYS),
            created_by=admin.id,
            email=req.email,
        )
        db.add(invite)
        await db.flush()
        req.status = "approved"
        req.invite_id = invite.id
        result.approved += 1
        audit(db, admin, "waitlist.approve", request_id=str(req.id), code=code)
        to_email.append((req.email, f"{origin}/login?invite={code}", req.name, req.locale))
    await db.commit()

    # After the commit: a failed email never undoes the approval (the admin can
    # still copy the invite link from Registro).
    for email, url, name, locale in to_email:
        try:
            await send_waitlist_approved_email(email, url, name=name, locale=locale)
        except Exception:
            result.emails_failed += 1
            logger.exception("Waitlist approval email failed")
    return result


# --- Feedback inbox ---------------------------------------------------------------------------


class FeedbackAdminResponse(BaseModel):
    id: UUID
    user_id: UUID
    username: str | None
    display_name: str | None
    kind: str
    text: str
    has_screenshot: bool
    page_url: str | None
    build_id: str | None
    user_agent: str | None
    status: str
    admin_note: str | None
    created_at: datetime
    updated_at: datetime


class FeedbackListResponse(BaseModel):
    items: list[FeedbackAdminResponse]
    total: int
    new_count: int


class FeedbackUpdate(BaseModel):
    status: Literal["new", "seen", "done"] | None = None
    admin_note: str | None = Field(default=None, max_length=5000)


def _feedback_response(fb: FeedbackReport, user: User | None) -> FeedbackAdminResponse:
    return FeedbackAdminResponse(
        id=fb.id,
        user_id=fb.user_id,
        username=user.username if user else None,
        display_name=user.display_name if user else None,
        kind=fb.kind,
        text=fb.text,
        has_screenshot=bool(fb.screenshot_path),
        page_url=fb.page_url,
        build_id=fb.build_id,
        user_agent=fb.user_agent,
        status=fb.status,
        admin_note=fb.admin_note,
        created_at=fb.created_at,
        updated_at=fb.updated_at,
    )


async def _new_feedback_count(db: AsyncSession) -> int:
    return int(
        (
            await db.execute(
                select(func.count(FeedbackReport.id)).where(FeedbackReport.status == "new")
            )
        ).scalar_one()
    )


@router.get("/feedback", response_model=FeedbackListResponse)
async def list_feedback(
    db: DB,
    _admin: AdminUser,
    status_filter: Literal["new", "seen", "done"] | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> FeedbackListResponse:
    query = select(FeedbackReport, User).join(User, User.id == FeedbackReport.user_id)
    count_query = select(func.count(FeedbackReport.id))
    if status_filter:
        query = query.where(FeedbackReport.status == status_filter)
        count_query = count_query.where(FeedbackReport.status == status_filter)
    rows = (
        await db.execute(
            query.order_by(FeedbackReport.created_at.desc())
            .limit(limit)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
    ).all()
    return FeedbackListResponse(
        items=[_feedback_response(fb, user) for fb, user in rows],
        total=int((await db.execute(count_query)).scalar_one()),
        new_count=await _new_feedback_count(db),
    )


@router.patch("/feedback/{feedback_id}", response_model=FeedbackAdminResponse)
async def update_feedback(
    feedback_id: UUID, data: FeedbackUpdate, db: DB, admin: AdminUser
) -> FeedbackAdminResponse:
    fb = await db.get(FeedbackReport, feedback_id, populate_existing=True)
    if fb is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    fields = data.model_fields_set
    changes: dict[str, Any] = {}
    if "status" in fields and data.status and data.status != fb.status:
        changes["status"] = {"from": fb.status, "to": data.status}
        fb.status = data.status
    if "admin_note" in fields and data.admin_note != fb.admin_note:
        changes["admin_note"] = True
        fb.admin_note = data.admin_note
    if changes:
        audit(db, admin, "feedback.update", fb.user_id, feedback_id=str(fb.id), **changes)
    await db.commit()
    await db.refresh(fb)
    user = await db.get(User, fb.user_id)
    return _feedback_response(fb, user)


@router.get("/feedback/{feedback_id}/screenshot")
async def get_feedback_screenshot(feedback_id: UUID, db: DB, _admin: AdminUser) -> FileResponse:
    fb = await db.get(FeedbackReport, feedback_id)
    if fb is None or not fb.screenshot_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No screenshot")
    base = Path(get_settings().storage_path).resolve()
    path = (base / fb.screenshot_path).resolve()
    if base not in path.parents or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No screenshot")
    return FileResponse(path, headers={"Cache-Control": "private, no-store"})


@router.get("/badge")
async def get_badge(db: DB, _admin: AdminUser) -> dict[str, int]:
    """Counters for the admin entry in the profile menu."""
    return {
        "feedback_new": await _new_feedback_count(db),
        "waitlist_pending": await _pending_waitlist_count(db),
    }


# --- System ------------------------------------------------------------------------------


@router.get("/system")
async def get_system(db: DB, _admin: AdminUser, refresh: bool = False) -> dict[str, Any]:
    if refresh:
        await uploads_usage(refresh=True)
    return await system_status(db)


# --- Announcement --------------------------------------------------------------------------


class AnnouncementPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    level: Literal["info", "warning"] = "info"
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def _tz(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        return v


@router.get("/announcement")
async def get_announcement_admin(db: DB, _admin: AdminUser) -> dict[str, Any]:
    value = await app_cfg.get_setting(db, app_cfg.KEY_ANNOUNCEMENT)
    return {"announcement": value if isinstance(value, dict) else None}


@router.put("/announcement")
async def put_announcement(data: AnnouncementPayload, db: DB, admin: AdminUser) -> dict[str, Any]:
    value = {
        # New id on every save, so users who dismissed the previous one see it.
        "id": uuid4().hex[:12],
        "text": data.text.strip(),
        "level": data.level,
        "expires_at": data.expires_at.isoformat() if data.expires_at else None,
    }
    await app_cfg.set_setting(db, app_cfg.KEY_ANNOUNCEMENT, value, admin.id)
    audit(db, admin, "announcement.set", **value)
    await db.commit()
    return {"announcement": value}


@router.delete("/announcement")
async def delete_announcement(db: DB, admin: AdminUser) -> dict[str, Any]:
    await app_cfg.set_setting(db, app_cfg.KEY_ANNOUNCEMENT, None, admin.id)
    audit(db, admin, "announcement.clear")
    await db.commit()
    return {"announcement": None}


# --- Audit log ------------------------------------------------------------------------------


class AuditEntry(BaseModel):
    id: UUID
    admin_id: UUID | None
    admin_username: str | None
    action: str
    target_user_id: UUID | None
    details: dict
    created_at: datetime


@router.get("/audit", response_model=list[AuditEntry])
async def list_audit(
    db: DB,
    _admin: AdminUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[AuditEntry]:
    rows = (
        await db.execute(
            select(AdminAuditLog, User.username)
            .outerjoin(User, User.id == AdminAuditLog.admin_id)
            .order_by(AdminAuditLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [
        AuditEntry(
            id=log.id,
            admin_id=log.admin_id,
            admin_username=username,
            action=log.action,
            target_user_id=log.target_user_id,
            details=log.details or {},
            created_at=log.created_at,
        )
        for log, username in rows
    ]
