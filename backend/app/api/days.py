"""Day moments API ("Momentos del día"): several looks per day.

`GET /days/{day}` returns the day's moments (each with its current look);
`POST /days/{day}/moments` adds a moment or regenerates one's suggestion
(AI when available, heuristic otherwise, optionally as a transition from the
previous moment); `DELETE /days/{day}/moments/{order}` removes an unworn moment.
Logging what was worn stays on `POST /outfits/{id}/feedback`.
"""

import logging
from datetime import date as Date
from datetime import time as Time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.outfits import (
    VALID_OCCASIONS,
    OutfitResponse,
    fetch_wore_instead_items_map,
    outfit_to_response,
)
from app.database import get_db
from app.models.user import User
from app.services.day_moments import (
    MAX_MOMENTS_PER_DAY,
    DayMoment,
    DayMomentService,
    MomentNotFoundError,
    MomentRequest,
    MomentWornError,
    TooManyMomentsError,
)
from app.services.recommendation_service import InsufficientWardrobeError
from app.utils.auth import get_current_user
from app.utils.error_codes import code_of, error_detail
from app.utils.rate_limit import rate_limit_by_user
from app.utils.timezone import get_user_today

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/days", tags=["Day moments"])

Db = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


class DayMomentResponse(BaseModel):
    order: int
    label: str | None = None
    time: Time | None = None
    occasion: str
    outfit: OutfitResponse | None = None
    is_worn: bool = False
    transition_from_order: int | None = None
    shared_item_ids: list[UUID] = Field(default_factory=list)
    # How many looks this moment has had (alternatives included).
    look_count: int = 0


class DayPlanResponse(BaseModel):
    date: Date
    moments: list[DayMomentResponse]
    max_moments: int = MAX_MOMENTS_PER_DAY


class MomentSuggestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order: int | None = Field(default=None, ge=0, le=50)
    label: Annotated[str | None, Field(max_length=40)] = None
    time: Time | None = None
    occasion: str | None = None
    transition: bool = False

    @field_validator("label")
    @classmethod
    def _clean_label(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = " ".join(v.split())
        return v or None

    @field_validator("occasion")
    @classmethod
    def _valid_occasion(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if v not in VALID_OCCASIONS:
            raise ValueError(
                f"Invalid occasion '{v}'. Must be one of: {', '.join(sorted(VALID_OCCASIONS))}"
            )
        return v


class MomentSuggestResponse(BaseModel):
    day: DayPlanResponse
    outfit_id: UUID
    engine: Literal["ai", "heuristic"]


def _parse_day(day: str, user: User) -> Date:
    if day == "today":
        return get_user_today(user)
    try:
        return Date.fromisoformat(day)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "INVALID_DAY", "message": "Use YYYY-MM-DD or 'today'"},
        ) from None


async def _day_response(
    db: AsyncSession, user: User, day: Date, moments: list[DayMoment]
) -> DayPlanResponse:
    current = [m.outfit for m in moments if m.outfit is not None]
    wore_map = await fetch_wore_instead_items_map(db, current, user_id=user.id)
    return DayPlanResponse(
        date=day,
        moments=[
            DayMomentResponse(
                order=m.order,
                label=m.label,
                time=m.at,
                occasion=m.occasion,
                outfit=outfit_to_response(m.outfit, wore_map) if m.outfit else None,
                is_worn=m.is_worn,
                transition_from_order=m.transition_from_order,
                shared_item_ids=m.shared_item_ids,
                look_count=len(m.outfits),
            )
            for m in moments
        ],
    )


@router.get("/{day}", response_model=DayPlanResponse)
async def get_day(day: str, db: Db, me: CurrentUser) -> DayPlanResponse:
    target = _parse_day(day, me)
    service = DayMomentService(db)
    return await _day_response(db, me, target, await service.get_day(me.id, target))


@router.post("/{day}/moments", response_model=MomentSuggestResponse)
async def suggest_moment(
    day: str, body: MomentSuggestRequest, db: Db, me: CurrentUser
) -> MomentSuggestResponse:
    await rate_limit_by_user(str(me.id), "suggest", max_requests=10, window_seconds=60)
    target = _parse_day(day, me)
    service = DayMomentService(db)
    try:
        result = await service.suggest(
            me,
            target,
            MomentRequest(
                order=body.order,
                label=body.label,
                at=body.time,
                occasion=body.occasion,
                transition=body.transition,
            ),
        )
    except TooManyMomentsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error_code": "TOO_MANY_MOMENTS", "message": "Too many moments for one day"},
        ) from None
    except MomentWornError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error_code": "MOMENT_WORN", "message": "This moment is already worn"},
        ) from None
    except InsufficientWardrobeError as e:
        logger.info(f"Moment suggestion refused: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail("insufficient_wardrobe"),
        ) from None
    except ValueError as e:
        # Location/weather problems on the AI path (same contract as /outfits/suggest).
        logger.info(f"Moment suggestion rejected: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail(code_of(e, "invalid_request")),
        ) from None

    moments = await service.get_day(me.id, target)
    return MomentSuggestResponse(
        day=await _day_response(db, me, target, moments),
        outfit_id=result.outfit.id,
        engine=result.engine,  # type: ignore[arg-type]
    )


@router.delete("/{day}/moments/{order}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_moment(day: str, order: int, db: Db, me: CurrentUser) -> Response:
    target = _parse_day(day, me)
    service = DayMomentService(db)
    try:
        await service.delete_moment(me.id, target, order)
    except MomentNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "MOMENT_NOT_FOUND", "message": "Moment not found"},
        ) from None
    except MomentWornError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error_code": "MOMENT_WORN", "message": "A worn moment can't be removed"},
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
