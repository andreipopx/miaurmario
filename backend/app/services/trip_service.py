"""«Modo viaje»: one look per day of a trip, from the clothes the person owns.

The whole trip is planned in ONE text call (not one per day), so the model can
see every day at once and pack light: the same trousers, coat and shoes across
days, the tops changing. Without AI (free plan, quota, provider down) the
heuristic composer dresses each day in turn, nudged to reuse what is already in
the suitcase. Each day is dressed for the forecast at the destination when the
day is within the 16-day horizon; further out it gets a neutral day, and
«Volver a planificar» picks the forecast up once it exists.
"""

from __future__ import annotations

import json
import logging
import random
import re
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem, ItemStatus
from app.models.trip import Trip
from app.models.user import User
from app.services.ai_access import require_ai_client
from app.services.ai_service import AIDisabledError
from app.services.day_moments import NEUTRAL_WEATHER, compose_outfit
from app.services.item_scorer import get_season, score_items
from app.services.pinterest_inspiration import pinterest_inspiration_lines
from app.services.weather_service import WeatherData, WeatherService, WeatherServiceError
from app.utils.clothing import ITEM_ROLE, canonical_item_order
from app.utils.prompts import load_prompt
from app.utils.style_profile import format_style_profile_for_prompt
from app.utils.style_quiz import layering_allowed

logger = logging.getLogger(__name__)

TRIP_PROMPT = load_prompt("trip_plan")

MAX_TRIP_DAYS = 14
#: The wardrobe handed to the model / the composer.
MAX_ITEMS = 300
MAX_EXTRAS = 4
#: Roles worth reusing across days (what makes a suitcase light).
REUSABLE_ROLES = {"bottom", "outer_layer", "footwear", "accessory"}


def trip_dates(trip: Trip) -> list[date]:
    days = (trip.end_date - trip.start_date).days + 1
    return [trip.start_date + timedelta(days=i) for i in range(max(0, min(days, MAX_TRIP_DAYS)))]


async def _forecasts(trip: Trip) -> dict[date, WeatherData]:
    """The destination's forecast for the trip days within the horizon."""
    try:
        days = await WeatherService().get_daily_forecast(trip.latitude, trip.longitude, days=16)
    except (WeatherServiceError, ValueError) as e:
        logger.info("No forecast for trip %s: %s", trip.id, e)
        return {}
    wanted = set(trip_dates(trip))
    out: dict[date, WeatherData] = {}
    for d in days:
        day = date.fromisoformat(str(d.date))
        if day in wanted:
            out[day] = WeatherService.forecast_as_weather(d)
    return out


def _weather_line(w: WeatherData | None) -> str:
    if w is None:
        return "sin previsión todavía"
    low = round(w.temperature - (w.feels_like - w.temperature))
    rain = f", lluvia {w.precipitation_chance}%" if w.precipitation_chance >= 30 else ""
    label = w.condition_label or w.condition
    return f"{low}–{round(w.feels_like)} °C, {label}{rain}"


def _item_line(n: int, item: ClothingItem) -> str:
    parts = [f"{item.subtype} ({item.type})" if item.subtype else item.type]
    colors = item.colors or ([item.primary_color] if item.primary_color else [])
    if colors:
        parts.append("/".join(colors[:3]))
    if item.pattern and item.pattern != "solid":
        parts.append(item.pattern)
    if item.material:
        parts.append(item.material)
    if item.formality:
        parts.append(item.formality)
    if item.name:
        parts.append(f"«{' '.join(item.name.split())[:40]}»")
    return f"{n}. " + " · ".join(parts)


def parse_trip_answer(
    raw: str, dates: list[date], number_map: dict[int, UUID]
) -> tuple[dict[date, tuple[list[UUID], str | None]], list[str]]:
    """The model's JSON → ({date: (item ids, note)}, extras). Bad entries are dropped."""
    match = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if not match:
        return {}, []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}, []
    wanted = set(dates)
    plan: dict[date, tuple[list[UUID], str | None]] = {}
    for entry in data.get("days") or []:
        if not isinstance(entry, dict):
            continue
        try:
            day = date.fromisoformat(str(entry.get("date")))
        except ValueError:
            continue
        if day not in wanted or day in plan:
            continue
        ids: list[UUID] = []
        for n in entry.get("items") or []:
            if isinstance(n, int) and n in number_map and number_map[n] not in ids:
                ids.append(number_map[n])
        note = entry.get("note")
        note = " ".join(note.split())[:200] if isinstance(note, str) and note.strip() else None
        if len(ids) >= 2:
            plan[day] = (ids, note)
    extras = [
        " ".join(e.split())[:60]
        for e in (data.get("extras") or [])
        if isinstance(e, str) and e.strip()
    ][:MAX_EXTRAS]
    return plan, extras


async def _wardrobe(db: AsyncSession, user_id: UUID) -> list[ClothingItem]:
    result = await db.execute(
        select(ClothingItem)
        .where(
            ClothingItem.user_id == user_id,
            ClothingItem.status == ItemStatus.ready,
            ClothingItem.is_archived.is_(False),
            ClothingItem.type != "unknown",
        )
        .order_by(ClothingItem.created_at.desc())
        .limit(MAX_ITEMS)
    )
    return list(result.scalars().all())


def heuristic_day(
    items: list[ClothingItem],
    weather: WeatherData,
    occasion: str,
    prefs,
    packed: set[UUID],
    rng: random.Random,
    lat: float | None,
) -> list[UUID]:
    """One day's look by the non-AI composer, preferring what is already packed."""
    scored = score_items(
        items=items,
        weather=weather,
        occasion=occasion,
        preferences=prefs,
        user_today=date.today(),
        current_season=get_season(date.today().month, lat),
        learned_prefs=None,
        good_pairs={},
        recently_worn_dates={},
        min_items=0,
    )

    def weight(item: ClothingItem, score: float) -> float:
        role = ITEM_ROLE.get((item.type or "").lower(), "accessory")
        if item.id in packed:
            # Reuse trousers, coat, shoes and bag; a top worn again reads as repeating.
            return score * (1.25 if role in REUSABLE_ROLES else 0.8)
        return score

    ranked = sorted(
        ((s.item, weight(s.item, s.score) * rng.uniform(0.9, 1.0)) for s in scored),
        key=lambda x: x[1],
        reverse=True,
    )
    composed = compose_outfit(
        ranked,
        weather,
        occasion,
        allow_layering=layering_allowed(prefs.taste_profile if prefs else None),
    )
    type_map = {i.id: (i.type or "").lower() for i in items}
    return canonical_item_order(composed.item_ids, type_map)


async def plan_trip(db: AsyncSession, trip: Trip) -> Trip:
    """Fill ``trip.days``, ``packing`` and ``extras``. Commits."""
    user = (
        await db.execute(
            select(User).where(User.id == trip.user_id).options(selectinload(User.preferences))
        )
    ).scalar_one()
    dates = trip_dates(trip)
    items = await _wardrobe(db, user.id)
    if len(items) < 2:
        trip.status, trip.error = "error", "wardrobe_too_small"
        await db.commit()
        return trip

    forecasts = await _forecasts(trip)
    prefs = user.preferences
    by_id = {i.id: i for i in items}
    plan: dict[date, tuple[list[UUID], str | None]] = {}
    extras: list[str] = []
    engine = "heuristic"

    try:
        ai = await require_ai_client(db, user, "text")
    except AIDisabledError:
        ai = None
    if ai is not None:
        number_map = {n: item.id for n, item in enumerate(items, 1)}
        style = format_style_profile_for_prompt(
            prefs,
            body_measurements=getattr(user, "body_measurements", None),
            inspiration_text=await pinterest_inspiration_lines(db, user.id),
        )
        day_lines = "\n".join(
            f"- {d.isoformat()} ({_WEEKDAYS[d.weekday()]}): {_weather_line(forecasts.get(d))}"
            for d in dates
        )
        prompt = (
            f"Destino: {trip.destination}{f', {trip.country}' if trip.country else ''}\n"
            f"Días:\n{day_lines}\n\n"
            f"Planes que ha contado: {(trip.plans or 'ninguno en especial').strip()[:500]}\n\n"
            f"Su estilo:\n{style}\n\n"
            "Prendas que tiene:\n"
            + "\n".join(_item_line(n, item) for n, item in enumerate(items, 1))
        )
        try:
            raw = await ai.generate_text(prompt, system_prompt=TRIP_PROMPT)
            plan, extras = parse_trip_answer(str(raw), dates, number_map)
            if plan:
                engine = "ai"
        except Exception as e:  # provider down or unusable answer: heuristic below
            logger.warning("Trip plan via AI failed for trip %s: %s", trip.id, type(e).__name__)

    # Any day the model left out (or all of them, without AI): the composer.
    rng = random.Random(str(trip.id))
    packed: set[UUID] = {i for ids, _ in plan.values() for i in ids}
    for d in dates:
        if d in plan:
            continue
        ids = heuristic_day(
            items, forecasts.get(d) or NEUTRAL_WEATHER, "casual", prefs, packed, rng, trip.latitude
        )
        if len(ids) >= 2:
            plan[d] = (ids, None)
            packed.update(ids)

    trip.days = [
        {
            "date": d.isoformat(),
            "weather": forecasts[d].to_dict() if d in forecasts else None,
            "item_ids": [str(i) for i in plan[d][0] if i in by_id],
            "note": plan[d][1],
        }
        for d in dates
        if d in plan
    ]
    previously_packed = {p["item_id"] for p in (trip.packing or []) if p.get("packed")}
    suitcase: list[str] = []
    for day in trip.days:
        for i in day["item_ids"]:
            if i not in suitcase:
                suitcase.append(i)
    trip.packing = [{"item_id": i, "packed": i in previously_packed} for i in suitcase]
    trip.extras = extras
    trip.engine = engine
    trip.status = "ready" if trip.days else "error"
    trip.error = None if trip.days else "cannot_compose"
    await db.commit()
    return trip


_WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
