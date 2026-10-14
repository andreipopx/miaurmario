"""«Modo viaje»: plan what to wear and pack for a trip."""

import logging
from datetime import date, timedelta
from typing import Annotated, Any
from uuid import UUID

from arq import create_pool
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import ClothingItem
from app.models.trip import Trip
from app.models.user import User
from app.schemas.item import ItemResponse
from app.services.trip_service import MAX_TRIP_DAYS
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user
from app.utils.timezone import get_user_today
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips", tags=["trips"])

Db = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# Planning is one AI call per trip (or replan): a handful a day is plenty.
PLAN_LIMIT = (12, 24 * 3600)
#: How far ahead a trip may start.
MAX_DAYS_AHEAD = 365


class TripCreate(BaseModel):
    destination: str = Field(min_length=1, max_length=120)
    country: str | None = Field(default=None, max_length=80)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)
    start_date: date
    end_date: date
    plans: str | None = Field(default=None, max_length=500)

    @field_validator("destination", "country", "plans")
    @classmethod
    def _squash(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = " ".join(v.split())
        return v or None

    @model_validator(mode="after")
    def _dates(self) -> "TripCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date is before start_date")
        if (self.end_date - self.start_date).days + 1 > MAX_TRIP_DAYS:
            raise ValueError(f"a trip is at most {MAX_TRIP_DAYS} days")
        return self


class PackingPatch(BaseModel):
    item_id: UUID
    packed: bool


def _summary(trip: Trip) -> dict[str, Any]:
    return {
        "id": str(trip.id),
        "destination": trip.destination,
        "country": trip.country,
        "start_date": trip.start_date.isoformat(),
        "end_date": trip.end_date.isoformat(),
        "status": trip.status,
        "error": trip.error,
        "days_count": (trip.end_date - trip.start_date).days + 1,
        "packed": sum(1 for p in trip.packing or [] if p.get("packed")),
        "to_pack": len(trip.packing or []),
    }


async def _detail(db: AsyncSession, trip: Trip) -> dict[str, Any]:
    ids = {UUID(p["item_id"]) for p in trip.packing or []}
    items = []
    if ids:
        rows = await db.execute(
            select(ClothingItem)
            .where(ClothingItem.user_id == trip.user_id, ClothingItem.id.in_(ids))
            .options(selectinload(ClothingItem.additional_images))
        )
        items = [ItemResponse.model_validate(i).model_dump(mode="json") for i in rows.scalars()]
    return {
        **_summary(trip),
        "latitude": trip.latitude,
        "longitude": trip.longitude,
        "plans": trip.plans,
        "engine": trip.engine,
        "days": trip.days or [],
        "packing": trip.packing or [],
        "extras": trip.extras or [],
        "items": items,
    }


async def _own(db: AsyncSession, user: User, trip_id: UUID) -> Trip:
    trip = await db.get(Trip, trip_id)
    if trip is None or trip.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return trip


async def _queue_plan(db: AsyncSession, user: User, trip: Trip) -> None:
    await rate_limit_by_user(user.id, "trip_plan", *PLAN_LIMIT)
    trip.status, trip.error = "planning", None
    await db.commit()
    redis = await create_pool(get_redis_settings())
    try:
        await redis.enqueue_job("plan_trip_job", str(trip.id), _queue_name="arq:tagging")
    finally:
        await redis.aclose()


@router.get("")
async def list_trips(db: Db, current_user: CurrentUser) -> dict[str, Any]:
    rows = await db.execute(
        select(Trip).where(Trip.user_id == current_user.id).order_by(Trip.start_date.desc())
    )
    today = get_user_today(current_user)
    trips = [_summary(t) for t in rows.scalars()]
    return {
        "upcoming": [t for t in trips if date.fromisoformat(t["end_date"]) >= today][::-1],
        "past": [t for t in trips if date.fromisoformat(t["end_date"]) < today],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_trip(data: TripCreate, db: Db, current_user: CurrentUser) -> dict[str, Any]:
    today = get_user_today(current_user)
    if data.end_date < today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "trip_in_the_past", "message": "That trip is already over."},
        )
    if data.start_date > today + timedelta(days=MAX_DAYS_AHEAD):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "trip_too_far", "message": "Plan it closer to the date."},
        )
    trip = Trip(user_id=current_user.id, **data.model_dump())
    db.add(trip)
    await db.flush()
    await _queue_plan(db, current_user, trip)
    return await _detail(db, trip)


@router.get("/{trip_id}")
async def get_trip(trip_id: UUID, db: Db, current_user: CurrentUser) -> dict[str, Any]:
    return await _detail(db, await _own(db, current_user, trip_id))


@router.post("/{trip_id}/plan")
async def replan_trip(trip_id: UUID, db: Db, current_user: CurrentUser) -> dict[str, Any]:
    """«Volver a planificar»: new looks (and the forecast, once the dates are near)."""
    trip = await _own(db, current_user, trip_id)
    await _queue_plan(db, current_user, trip)
    return await _detail(db, trip)


@router.patch("/{trip_id}/packing")
async def pack_item(
    trip_id: UUID, data: PackingPatch, db: Db, current_user: CurrentUser
) -> dict[str, Any]:
    trip = await _own(db, current_user, trip_id)
    key = str(data.item_id)
    if not any(p["item_id"] == key for p in trip.packing or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in this suitcase")
    # A new list, so SQLAlchemy sees the JSONB change.
    trip.packing = [
        {**p, "packed": data.packed} if p["item_id"] == key else p for p in trip.packing
    ]
    await db.commit()
    return _summary(trip)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(trip_id: UUID, db: Db, current_user: CurrentUser) -> None:
    await db.delete(await _own(db, current_user, trip_id))
    await db.commit()
