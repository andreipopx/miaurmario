"""Feed API — "outfit del día" from friends and public (Sprint 3)."""

import base64
import binascii
import json
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.outfits import get_user_today
from app.database import get_db
from app.models.outfit import Outfit, OutfitVisibility
from app.models.user import User
from app.services.friendship_service import FriendshipService
from app.utils.auth import get_current_user

router = APIRouter(prefix="/feed", tags=["Feed"])


class FeedAuthor(BaseModel):
    id: UUID
    username: str | None
    display_name: str
    avatar_url: str | None = None


class FeedOutfit(BaseModel):
    id: UUID
    occasion: str
    scheduled_for: str | None = None
    name: str | None = None
    reasoning: str | None = None
    style_notes: str | None = None
    visibility: str
    created_at: datetime
    author: FeedAuthor


class FeedPage(BaseModel):
    items: list[FeedOutfit]
    next_cursor: str | None = None


def _encode_cursor(created_at: datetime, outfit_id: UUID) -> str:
    payload = json.dumps({"c": created_at.isoformat(), "i": str(outfit_id)}).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    padding = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + padding)
        obj = json.loads(raw)
        return datetime.fromisoformat(obj["c"]), UUID(obj["i"])
    except (binascii.Error, ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail="invalid_cursor") from exc


@router.get("/today", response_model=FeedPage)
async def feed_today(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(description="Opaque pagination cursor")] = None,
) -> FeedPage:
    friend_ids = await FriendshipService(db).accepted_friend_ids(current_user)
    today = get_user_today(current_user)

    friends_clause = (
        and_(Outfit.visibility == OutfitVisibility.friends, Outfit.user_id.in_(friend_ids))
        if friend_ids
        else None
    )
    public_clause = Outfit.visibility == OutfitVisibility.public
    visibility_clause = or_(friends_clause, public_clause) if friends_clause is not None else public_clause

    stmt = (
        select(Outfit)
        .where(Outfit.scheduled_for == today)
        .where(Outfit.user_id != current_user.id)
        .where(visibility_clause)
        .options(selectinload(Outfit.user))
        .order_by(Outfit.created_at.desc(), Outfit.id.desc())
        .limit(limit + 1)
    )

    if cursor:
        cursor_created, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Outfit.created_at < cursor_created,
                and_(Outfit.created_at == cursor_created, Outfit.id < cursor_id),
            )
        )

    rows = list((await db.execute(stmt)).scalars().all())

    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)

    items = [
        FeedOutfit(
            id=o.id,
            occasion=o.occasion,
            scheduled_for=o.scheduled_for.isoformat() if o.scheduled_for else None,
            name=o.name,
            reasoning=o.reasoning,
            style_notes=o.style_notes,
            visibility=o.visibility.value,
            created_at=o.created_at,
            author=FeedAuthor(
                id=o.user.id,
                username=getattr(o.user, "username", None),
                display_name=o.user.display_name,
                avatar_url=o.user.avatar_url,
            ),
        )
        for o in rows
    ]
    return FeedPage(items=items, next_cursor=next_cursor)
