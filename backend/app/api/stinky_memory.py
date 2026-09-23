"""«Stinky recuerda»: the user's own view of the notebook Stinky writes.

Everything here is scoped to ``current_user``: a memory is never readable or
writable by anybody else (not friends, not family, not admins through this
router), and it never appears on a social page. The user is in control — they
can rewrite a note, pin it, delete one or wipe the lot.
"""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stinky_memory import (
    MAX_MEMORIES_PER_USER,
    MAX_MEMORY_TEXT_CHARS,
    MEMORY_KIND_NAME,
    MEMORY_KINDS,
    StinkyMemory,
)
from app.models.user import User
from app.services import stinky_memory as memory_service
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stinky/memory", tags=["Stinky memory"])


# --- Schemas --------------------------------------------------------------------------


class MemoryOut(BaseModel):
    id: UUID
    kind: str
    text: str
    source: str
    pinned: bool
    created_at: str
    updated_at: str


class MemoryList(BaseModel):
    """The whole notebook, plus what the user needs to understand it."""

    call_name: str | None = None
    memories: list[MemoryOut] = []
    max_entries: int = MAX_MEMORIES_PER_USER
    max_text_chars: int = MAX_MEMORY_TEXT_CHARS


class MemoryUpdate(BaseModel):
    text: str | None = Field(default=None, max_length=MAX_MEMORY_TEXT_CHARS)
    pinned: bool | None = None

    @field_validator("text")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = memory_service.clean_memory_text(v)
        if len(cleaned) < 2:
            raise ValueError("The note is empty")
        return cleaned


class CallNameUpdate(BaseModel):
    """«¿Cómo quieres que te llame?» — empty/None clears it."""

    name: str | None = Field(default=None, max_length=memory_service.MAX_CALL_NAME_CHARS)


class DeletedCount(BaseModel):
    deleted: int


def _out(row: StinkyMemory) -> MemoryOut:
    return MemoryOut(
        id=row.id,
        kind=row.kind if row.kind in MEMORY_KINDS else "fact",
        text=row.text,
        source=row.source,
        pinned=bool(row.pinned),
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


async def _list_response(db: AsyncSession, user_id: UUID) -> MemoryList:
    rows = await memory_service.list_memories(db, user_id)
    return MemoryList(
        call_name=next((r.text for r in rows if r.kind == MEMORY_KIND_NAME), None),
        # The preferred name has its own field and its own UI control.
        memories=[_out(r) for r in rows if r.kind != MEMORY_KIND_NAME],
    )


# --- Endpoints ------------------------------------------------------------------------


@router.get("", response_model=MemoryList)
async def list_memory(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MemoryList:
    """Everything Stinky remembers about you."""
    return await _list_response(db, current_user.id)


@router.patch("/{memory_id}", response_model=MemoryOut)
async def update_memory(
    memory_id: UUID,
    data: MemoryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MemoryOut:
    """Rewrite a note or (un)pin it. Edited notes become ``source = "user"``."""
    await rate_limit_by_user(current_user.id, "stinky_memory_edit", 60, 60)
    row = await memory_service.get_memory(db, current_user.id, memory_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    if data.text is not None:
        if memory_service.sensitive_category(data.text) is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "sensitive", "message": "Stinky does not keep notes like that."},
            )
        row.text = data.text
        row.source = "user"
    if data.pinned is not None:
        row.pinned = data.pinned
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    row = await memory_service.get_memory(db, current_user.id, memory_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    await db.delete(row)
    await db.commit()


@router.delete("", response_model=DeletedCount)
async def clear_memory(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DeletedCount:
    """«Borrar todo»: Stinky forgets everything, including the preferred name."""
    deleted = await memory_service.clear_memories(db, current_user.id)
    await db.commit()
    return DeletedCount(deleted=deleted)


@router.put("/name", response_model=MemoryList)
async def set_call_name(
    data: CallNameUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MemoryList:
    """Set (or clear) the name Stinky calls you — not your account name."""
    await rate_limit_by_user(current_user.id, "stinky_memory_name", 30, 60)
    name = memory_service.clean_memory_text(data.name or "", memory_service.MAX_CALL_NAME_CHARS)
    if not name:
        await memory_service.forget_call_name(db, current_user.id)
    else:
        try:
            await memory_service.remember(
                db, current_user.id, MEMORY_KIND_NAME, name, source="user", confidence=1.0
            )
        except memory_service.MemoryRefused as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": e.code, "message": str(e)},
            ) from None
    await db.commit()
    return await _list_response(db, current_user.id)
