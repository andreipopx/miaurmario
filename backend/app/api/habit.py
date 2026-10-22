"""Stinky's meals, level, streak and what he wears (app/services/habit.py)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.habit import ACCESSORIES, LEVELS, build_habit, worn_days
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
