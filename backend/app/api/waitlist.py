"""Public waitlist for the closed beta (``signup_mode = invite_only``).

The answer is always the same 202 ("we'll let you know"), whether the email is
new, already on the list or already has an account, so this endpoint cannot be
used to find out who uses Miaurmario. Accounts are never touched from here.
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import WaitlistRequest
from app.services import notification_queue
from app.services.user_service import UserService
from app.utils.rate_limit import check_rate_limit, rate_limit_by_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/waitlist", tags=["Waitlist"])

WAITLIST_MESSAGE_MAX = 280


class WaitlistJoin(BaseModel):
    email: EmailStr
    name: str | None = Field(default=None, max_length=100)
    message: str | None = Field(default=None, max_length=WAITLIST_MESSAGE_MAX)
    locale: Literal["es", "en"] | None = None

    @field_validator("name", "message")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class WaitlistAccepted(BaseModel):
    status: Literal["ok"] = "ok"


@router.post("", response_model=WaitlistAccepted, status_code=status.HTTP_202_ACCEPTED)
async def join_waitlist(
    payload: WaitlistJoin,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WaitlistAccepted:
    await rate_limit_by_ip(request, "waitlist_join", 10, 3600)
    email_l = payload.email.strip().lower()
    await check_rate_limit(f"rate_limit:waitlist_email:{email_l}", 3, 3600)

    if await UserService(db).get_by_email(email_l) is not None:
        return WaitlistAccepted()  # already has an account: say nothing, store nothing

    result = await db.execute(
        insert(WaitlistRequest)
        .values(
            email=email_l,
            name=payload.name,
            message=payload.message,
            locale=payload.locale or "es",
        )
        .on_conflict_do_nothing(index_elements=[WaitlistRequest.email])
        .returning(WaitlistRequest.id)
    )
    new_id = result.scalar_one_or_none()
    await db.commit()
    if new_id is not None:  # only brand-new requests ping the admins
        await notification_queue.enqueue_waitlist_admin_notification(new_id)
    return WaitlistAccepted()
