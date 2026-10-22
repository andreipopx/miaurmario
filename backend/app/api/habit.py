"""Stinky's meals, level, streak and what he wears (app/services/habit.py)."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.item import GarmentPhoto
from app.services.habit import ACCESSORIES, LEVELS, build_habit, worn_days
from app.services.wrapped import GarmentStat, build_wrapped
from app.utils.auth import get_current_user
from app.utils.timezone import get_user_today

router = APIRouter(prefix="/habit", tags=["Habit"])


class HabitResponse(BaseModel):
    today: date
    fed_today: bool
    meals: int
    level: int
    level_starts_at: int
    next_level_at: int | None
    week_days: list[date]
    weekly_goal: int
    week_met: bool
    streak_weeks: int
    best_streak_weeks: int
    frozen_weeks: list[date]
    comodin_left_this_month: bool
    unlocked: list[str]
    #: Every accessory and the level it needs, so locked ones can be shown too.
    accessories: dict[str, int]
    accessory: str | None
    last_meal: date | None
    welcome_back: bool
    levels: list[int]


class HabitUpdate(BaseModel):
    weekly_goal: int | None = Field(default=None, ge=1, le=7)
    #: An unlocked accessory id, or "" to take it off.
    accessory: str | None = Field(default=None, max_length=20)


async def _habit(db: AsyncSession, user: User) -> HabitResponse:
    habit = build_habit(await worn_days(db, user.id), get_user_today(user), user.weekly_goal)
    accessory = user.stinky_accessory if user.stinky_accessory in habit.unlocked else None
    return HabitResponse(
        **habit.__dict__,
        accessories=ACCESSORIES,
        accessory=accessory,
        levels=list(LEVELS),
    )


@router.get("", response_model=HabitResponse)
async def get_habit(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HabitResponse:
    return await _habit(db, current_user)


@router.patch("", response_model=HabitResponse)
async def update_habit(
    payload: HabitUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HabitResponse:
    fields = payload.model_dump(exclude_unset=True)
    if "weekly_goal" in fields:
        current_user.weekly_goal = fields["weekly_goal"]
    if "accessory" in fields:
        wanted = fields["accessory"] or None
        if wanted is not None:
            habit = build_habit(
                await worn_days(db, current_user.id),
                get_user_today(current_user),
                current_user.weekly_goal,
            )
            if wanted not in habit.unlocked:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"code": "accessory_locked", "message": "Not unlocked yet"},
                )
        current_user.stinky_accessory = wanted
    await db.commit()
    return await _habit(db, current_user)


class WrappedGarment(BaseModel):
    id: str
    name: str | None
    type: str
    primary_color: str | None
    photo: GarmentPhoto
    count: int = 0
    cost_per_wear: Decimal | None = None


class WrappedResponse(BaseModel):
    month: date
    until: date
    days_logged: int
    looks_worn: int
    garments_worn: int
    wardrobe_size: int
    top: list[WrappedGarment]
    top_color: str | None
    added: int
    added_by_way: dict[str, int]
    forgotten_count: int
    forgotten: list[WrappedGarment]
    wardrobe_value: Decimal | None
    average_cost_per_wear: Decimal | None
    best_value: WrappedGarment | None
    #: Stinky's side of the month.
    meals_total: int
    level: int
    best_streak_weeks: int


def _garment(stat: GarmentStat) -> WrappedGarment:
    item = stat.item
    return WrappedGarment(
        id=str(item.id),
        name=item.name,
        type=item.type,
        primary_color=item.primary_color,
        photo=GarmentPhoto(image_path=item.image_path, thumbnail_path=item.thumbnail_path),
        count=stat.count,
        cost_per_wear=stat.cost_per_wear,
    )


@router.get("/wrapped", response_model=WrappedResponse)
async def get_wrapped(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> WrappedResponse:
    """«Tu mes con Stinky». Without ``month``: the current month in its first
    days counts as just started, so the month before is the one worth a recap."""
    today = get_user_today(current_user)
    if month:
        year, mon = (int(x) for x in month.split("-"))
        try:
            first = date(year, mon, 1)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "bad_month"}) from None
        if first > today:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "future_month"})
    else:
        first = today.replace(day=1)
        if today.day <= 5:
            first = (first - timedelta(days=1)).replace(day=1)
    wrapped = await build_wrapped(db, current_user.id, first, today)
    habit = build_habit(await worn_days(db, current_user.id), today, current_user.weekly_goal)
    return WrappedResponse(
        month=wrapped.month,
        until=wrapped.until,
        days_logged=wrapped.days_logged,
        looks_worn=wrapped.looks_worn,
        garments_worn=wrapped.garments_worn,
        wardrobe_size=wrapped.wardrobe_size,
        top=[_garment(g) for g in wrapped.top],
        top_color=wrapped.top_color,
        added=wrapped.added,
        added_by_way=wrapped.added_by_way,
        forgotten_count=wrapped.forgotten_count,
        forgotten=[_garment(g) for g in wrapped.forgotten],
        wardrobe_value=wrapped.wardrobe_value,
        average_cost_per_wear=wrapped.average_cost_per_wear,
        best_value=_garment(wrapped.best_value) if wrapped.best_value else None,
        meals_total=habit.meals,
        level=habit.level,
        best_streak_weeks=habit.best_streak_weeks,
    )
