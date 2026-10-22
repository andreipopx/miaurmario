"""Stinky eats looks: the daily habit, the weekly streak and what it unlocks.

Finch, not Pou. Every day you say what you wore is one meal for Stinky (one a
day, however many looks: logging is the habit, not farming). Meals grow him
through levels that unlock things to wear. Nothing is ever taken away and he
never goes hungry for real: a gap means he is asleep on the sofa, and the first
look back is a welcome, not a scolding.

The streak counts weeks, not days: a week is kept when it has at least the
person's goal of days logged (3 by default). One missed week per calendar month
is covered by a «comodín» on its own, so a holiday does not reset months of
habit. Everything is derived from what is already stored — no counters to drift.

"Wore something on day D" is any of:
* ``user_feedback.worn_at`` (Me lo pongo, Me puse otra cosa, Qué llevo, the
  lookbook's «Me lo pongo hoy»), and
* ``item_history.worn_at`` (a single garment marked as worn).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemHistory
from app.models.outfit import Outfit, UserFeedback

DEFAULT_WEEKLY_GOAL = 3
#: Meals needed for each level; the level is how many thresholds are reached.
LEVELS = (0, 3, 7, 15, 30, 60, 100, 180, 365)
#: What each level unlocks for Stinky to wear (level → accessory id).
ACCESSORIES: dict[str, int] = {
    "pajarita": 1,
    "cascabel": 2,
    "panuelo": 3,
    "lazo": 4,
    "perlas": 5,
    "pajarita-dorada": 6,
}
#: Days without a look after which Stinky greets you back instead of nagging.
WELCOME_BACK_AFTER = 3
#: How far back the streak looks (a year of weeks is plenty for any screen).
STREAK_HORIZON_WEEKS = 104


@dataclass
class Habit:
    today: date
    fed_today: bool
    meals: int
    level: int
    #: Meals at which the next level starts (None at the top).
    next_level_at: int | None
    level_starts_at: int
    week_days: list[date]
    weekly_goal: int
    week_met: bool
    streak_weeks: int
    best_streak_weeks: int
    #: Weeks of the current streak a comodín covered.
    frozen_weeks: list[date] = field(default_factory=list)
    comodin_left_this_month: bool = True
    unlocked: list[str] = field(default_factory=list)
    last_meal: date | None = None
    welcome_back: bool = False


def level_for(meals: int) -> int:
    return sum(1 for threshold in LEVELS[1:] if meals >= threshold)


def unlocked_for(level: int) -> list[str]:
    return [name for name, needed in ACCESSORIES.items() if level >= needed]


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def streaks(days: set[date], today: date, goal: int) -> tuple[int, int, list[date], bool]:
    """Current streak in weeks, the best one, the weeks a comodín covered in the
    current streak, and whether this month's comodín is still unused.

    A finished week is kept when it reached the goal, or by the month's comodín
    (one per calendar month of the week's Monday). The current week counts once
    it reaches the goal; until then it cannot break anything. Weeks before the
    first logged day never count against anyone.
    """
    if not days:
        return 0, 0, [], True
    first = monday(min(days))
    this_week = monday(today)
    per_week: dict[date, int] = {}
    for day in days:
        per_week[monday(day)] = per_week.get(monday(day), 0) + 1

    used_comodin: set[tuple[int, int]] = set()
    current = best = 0
    frozen_in_current: list[date] = []
    week = max(first, this_week - timedelta(weeks=STREAK_HORIZON_WEEKS))
    while week < this_week:
        month = (week.year, week.month)
        if per_week.get(week, 0) >= goal:
            current += 1
        elif month not in used_comodin:
            used_comodin.add(month)
            current += 1
            frozen_in_current.append(week)
        else:
            current = 0
            frozen_in_current = []
        best = max(best, current)
        week += timedelta(weeks=1)
    if per_week.get(this_week, 0) >= goal:
        current += 1
        best = max(best, current)
    comodin_left = (today.year, today.month) not in used_comodin
    return current, best, frozen_in_current, comodin_left


async def worn_days(db: AsyncSession, user_id: UUID) -> set[date]:
    looks = (
        select(UserFeedback.worn_at.label("day"))
        .join(Outfit, Outfit.id == UserFeedback.outfit_id)
        .where(Outfit.user_id == user_id, UserFeedback.worn_at.is_not(None))
    )
    garments = (
        select(ItemHistory.worn_at.label("day"))
        .join(ClothingItem, ClothingItem.id == ItemHistory.item_id)
        .where(ClothingItem.user_id == user_id)
    )
    rows = await db.execute(union(looks, garments))
    return {row[0] for row in rows if row[0] is not None}


def build_habit(days: set[date], today: date, goal: int | None) -> Habit:
    goal = goal if goal and 1 <= goal <= 7 else DEFAULT_WEEKLY_GOAL
    # A look logged for tomorrow (the trip, «Tu look de mañana») is not a meal yet.
    eaten = {d for d in days if d <= today}
    meals = len(eaten)
    level = level_for(meals)
    week_start = monday(today)
    week_days = sorted(d for d in eaten if week_start <= d <= today)
    current, best, frozen, comodin_left = streaks(eaten, today, goal)
    last = max(eaten) if eaten else None
    return Habit(
        today=today,
        fed_today=today in eaten,
        meals=meals,
        level=level,
        next_level_at=LEVELS[level + 1] if level + 1 < len(LEVELS) else None,
        level_starts_at=LEVELS[level],
        week_days=week_days,
        weekly_goal=goal,
        week_met=len(week_days) >= goal,
        streak_weeks=current,
        best_streak_weeks=best,
        frozen_weeks=frozen,
        comodin_left_this_month=comodin_left,
        unlocked=unlocked_for(level),
        last_meal=last,
        welcome_back=bool(
            last and today not in eaten and (today - last).days >= WELCOME_BACK_AFTER
        ),
    )
