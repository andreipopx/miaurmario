"""Friends API (Sprint 3)."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.friendship import Friendship, FriendshipStatus
from app.models.user import User
from app.services.friendship_service import (
    DuplicateFriendshipError,
    FriendNotFoundError,
    FriendshipService,
    NotAddresseeError,
    NotPendingError,
    SelfFriendshipError,
)
from app.utils.auth import get_current_user

router = APIRouter(prefix="/friends", tags=["Friends"])


class FriendRequestBody(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]{3,20}$")


class BlockRequestBody(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]{3,20}$")


class FriendUser(BaseModel):
    id: UUID
    username: str | None
    display_name: str
    avatar_url: str | None = None


class FriendshipResponse(BaseModel):
    id: UUID
    status: FriendshipStatus
    direction: Literal["outgoing", "incoming"]
    other: FriendUser


def _to_response(f: Friendship, current_user: User) -> FriendshipResponse:
    if f.requester_id == current_user.id:
        other, direction = f.addressee, "outgoing"
    else:
        other, direction = f.requester, "incoming"
    return FriendshipResponse(
        id=f.id,
        status=f.status,
        direction=direction,
        other=FriendUser(
            id=other.id,
            username=getattr(other, "username", None),
            display_name=other.display_name,
            avatar_url=other.avatar_url,
        ),
    )


def _map_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FriendNotFoundError):
        return HTTPException(status_code=404, detail={"error_code": exc.code})
    if isinstance(exc, SelfFriendshipError):
        return HTTPException(status_code=400, detail={"error_code": exc.code})
    if isinstance(exc, DuplicateFriendshipError):
        return HTTPException(status_code=409, detail={"error_code": exc.code})
    if isinstance(exc, (NotAddresseeError, NotPendingError)):
        return HTTPException(status_code=404, detail={"error_code": exc.code})
    return HTTPException(status_code=500, detail="Internal error")


@router.post("/request", response_model=FriendshipResponse, status_code=status.HTTP_201_CREATED)
async def request_friend(
    body: FriendRequestBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FriendshipResponse:
    service = FriendshipService(db)
    try:
        friendship = await service.request(current_user, body.username)
    except (FriendNotFoundError, SelfFriendshipError, DuplicateFriendshipError) as exc:
        raise _map_error(exc) from exc
    await db.commit()
    await db.refresh(friendship, attribute_names=["requester", "addressee"])
    return _to_response(friendship, current_user)


@router.post("/{friendship_id}/accept", response_model=FriendshipResponse)
async def accept_friend(
    friendship_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FriendshipResponse:
    service = FriendshipService(db)
    try:
        friendship = await service.accept(current_user, friendship_id)
    except (NotAddresseeError, NotPendingError) as exc:
        raise _map_error(exc) from exc
    await db.commit()
    await db.refresh(friendship, attribute_names=["requester", "addressee"])
    return _to_response(friendship, current_user)


@router.post("/{friendship_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_friend(
    friendship_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    service = FriendshipService(db)
    try:
        await service.decline(current_user, friendship_id)
    except (NotAddresseeError, NotPendingError) as exc:
        raise _map_error(exc) from exc
    await db.commit()


@router.post("/block", response_model=FriendshipResponse)
async def block_user(
    body: BlockRequestBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FriendshipResponse:
    service = FriendshipService(db)
    try:
        friendship = await service.block(current_user, body.username)
    except (FriendNotFoundError, SelfFriendshipError) as exc:
        raise _map_error(exc) from exc
    await db.commit()
    await db.refresh(friendship, attribute_names=["requester", "addressee"])
    return _to_response(friendship, current_user)


@router.get("", response_model=list[FriendshipResponse])
async def list_friends(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    status_filter: Annotated[
        Literal["pending", "accepted", "blocked"] | None,
        Query(alias="status", description="Filter by friendship status"),
    ] = None,
) -> list[FriendshipResponse]:
    service = FriendshipService(db)
    parsed = FriendshipStatus(status_filter) if status_filter else None
    friendships = await service.list_friends(current_user, parsed)
    for f in friendships:
        await db.refresh(f, attribute_names=["requester", "addressee"])
    return [_to_response(f, current_user) for f in friendships]
