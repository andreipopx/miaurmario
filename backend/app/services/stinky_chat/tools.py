"""Function-calling tools for the Stinky chat.

Every tool runs on behalf of exactly one user (``ToolContext.user``), taken from
the authenticated request, never from model arguments: all queries filter by
``user_id`` so the model cannot read or write another user's data even if it is
tricked into passing foreign ids.

Results are JSON-serialisable dicts. Free text that comes from user data (item
names, notes, outfit names) is cleaned and length-capped, and every result is
wrapped as ``{"ok": ..., "data": ...}`` so the system prompt can tell the model
to treat it strictly as data.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitItem, OutfitSource
from app.models.preference import UserPreference
from app.models.stinky_memory import MAX_MEMORIES_PER_USER, MEMORY_KINDS
from app.models.user import User
from app.services import stinky_memory
from app.services.ai_service import AIDisabledError
from app.services.studio_service import ItemOwnershipError, StudioService
from app.services.weather_service import (
    GeocodingServiceError,
    WeatherService,
    WeatherServiceError,
)
from app.utils.style_profile import format_style_profile_for_prompt
from app.utils.timezone import get_user_today

logger = logging.getLogger(__name__)

MAX_WARDROBE_ITEMS = 80
DEFAULT_WARDROBE_ITEMS = 60
MAX_OUTFIT_ITEMS = 8
MAX_RECENT_DAYS = 60
MAX_TOOL_RESULT_CHARS = 12000
#: How many notes Stinky may write in one user message...
MAX_MEMORY_WRITES_PER_TURN = 3
#: ...and in one conversation, per hour (Redis-backed; fails open).
MAX_MEMORY_WRITES_PER_CONVERSATION = 15
MEMORY_WRITE_WINDOW_SECONDS = 3600

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")


def clean_text(value: Any, limit: int = 80) -> str | None:
    """User-provided text as inert data: no control chars/newlines, capped length."""
    if value is None:
        return None
    text = _CONTROL_RE.sub(" ", str(value)).strip()
    text = re.sub(r"\s{2,}", " ", text)
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text or None


class ToolError(Exception):
    """A tool failed in a way the model should see (bad args, not found...)."""


@dataclass
class ToolContext:
    db: AsyncSession
    user: User
    # Outfit cards produced during this turn (shown inline in the chat UI).
    cards: list[dict[str, Any]] = field(default_factory=list)
    outfit_created: bool = False
    # "Stinky ha tomado nota: ..." written during this turn (shown inline too).
    notes: list[dict[str, Any]] = field(default_factory=list)
    # Which conversation this turn belongs to (rate-limits the memory writes).
    conversation_id: UUID | None = None
    memory_writes: int = 0


# --- Tool schemas (OpenAI function-calling format) ----------------------------------

_DATE_DESC = "Date in ISO format YYYY-MM-DD. Omit for today."

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_wardrobe",
            "description": (
                "List the user's own clothing items (only real, owned items). Each item has "
                "id, name, type, colors, style, formality, season, times_worn, last_worn and "
                "needs_wash. Use filters to narrow the list."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "description": "Item type, e.g. shirt, jeans, sneakers, coat.",
                    },
                    "color": {"type": "string", "description": "Color, e.g. black, navy."},
                    "season": {
                        "type": "string",
                        "enum": ["spring", "summer", "fall", "winter", "all-season"],
                    },
                    "formality": {
                        "type": "string",
                        "enum": [
                            "very-casual",
                            "casual",
                            "smart-casual",
                            "business-casual",
                            "formal",
                        ],
                    },
                    "style": {"type": "string", "description": "e.g. minimalist, classic."},
                    "search": {"type": "string", "description": "Text search in names."},
                    "include_needs_wash": {
                        "type": "boolean",
                        "description": "Include items that need washing (default true).",
                    },
                    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_WARDROBE_ITEMS},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": (
                "Weather at the user's saved location: current conditions for today, "
                "daily forecast for a date up to 15 days ahead."
            ),
            "parameters": {
                "type": "object",
                "properties": {"date": {"type": "string", "description": _DATE_DESC}},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_outfits",
            "description": "The user's outfits from the last N days (default 14, max 60).",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "minimum": 1, "maximum": MAX_RECENT_DAYS}
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_listening_mood",
            "description": (
                "What the user's music sounds like, for dressing only: the track playing "
                "now or last (via Spotify or Last.fm), genres, mood tags, how today's "
                "music sounds (music_today) and whether the user allows an optional "
                "brighter contrast look (contrast)."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_preferences",
            "description": (
                "The user's style preferences: favourite/avoided colors, style profile, "
                "default occasion, temperature sensitivity, location name, plus "
                "style_summary (a ready-to-use Spanish summary of their taste)."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_outfit",
            "description": (
                "Show the user an outfit card built from items they own (ids from "
                "get_wardrobe). It is NOT saved; the user can save it with a button. Use it "
                "whenever you propose a concrete combination."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "item_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": MAX_OUTFIT_ITEMS,
                    },
                    "name": {"type": "string", "description": "Short title for the look."},
                    "occasion": {"type": "string"},
                },
                "required": ["item_ids", "name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_outfit",
            "description": (
                "Save an outfit to the user's looks. Only call it when the user asks to "
                "save/create/plan a look. item_ids must come from get_wardrobe."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "item_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": MAX_OUTFIT_ITEMS,
                    },
                    "name": {"type": "string"},
                    "occasion": {"type": "string"},
                    "date": {
                        "type": "string",
                        "description": "Plan it for this date (YYYY-MM-DD). Omit to save "
                        "it as a look without a date.",
                    },
                },
                "required": ["item_ids", "name", "occasion"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_outfit",
            "description": (
                "Ask the Miaurmario stylist engine for a complete outfit for an occasion "
                "(uses weather, wear history and learned taste). The outfit is created and "
                "shown to the user as a card. Slower than composing one yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "occasion": {
                        "type": "string",
                        "description": "casual, office, formal, date, party, wedding, "
                        "dinner, sport, travel, interview, weekend...",
                    },
                    "date": {"type": "string", "description": _DATE_DESC},
                },
                "required": ["occasion"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": (
                "Write one short, durable note about this person to your notebook "
                "(«Stinky recuerda»), so you still know it in future conversations. Only "
                "for stable things that help dress them: the name they want to be called, "
                "styles/colours/materials they love or refuse, fit preferences, recurring "
                "plans (office on Tuesdays), climate, sizes, material allergies, upcoming "
                "events. NEVER for health, body, weight, religion, sexuality, politics, "
                "money problems, secrets, third parties, or anything said once in passing. "
                "Saying nearly the same thing again updates the existing note. The user "
                "sees every note and can edit or delete it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": list(MEMORY_KINDS),
                        "description": (
                            "name = what to call them; preference = what they like; "
                            "dislike = what they refuse; context = their routine/climate; "
                            "plan = a recurring or upcoming plan; fact = anything else "
                            "useful for dressing them (sizes, materials)."
                        ),
                    },
                    "text": {
                        "type": "string",
                        "description": (
                            "The note, in the user's language, third person, at most 200 "
                            'characters. E.g. "prefiere pantalón ancho", "no lleva rojo", '
                            '"trabaja en oficina los martes".'
                        ),
                    },
                },
                "required": ["kind", "text"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "forget",
            "description": (
                "Delete a note from your notebook when the person says it is wrong or no "
                "longer true. Pass the id from a previous remember, or the text of the note."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Id returned by remember."},
                    "text": {
                        "type": "string",
                        "description": "The note's text, if you have no id.",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
]

TOOL_NAMES = {t["function"]["name"] for t in TOOL_DEFINITIONS}


# --- Helpers ---------------------------------------------------------------------------


def _parse_date(value: Any, today: date, *, allow_past: bool = False) -> date | None:
    if value in (None, ""):
        return None
    try:
        parsed = date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ToolError("Invalid date; use YYYY-MM-DD.") from None
    if not allow_past and parsed < today:
        raise ToolError("The date is in the past.")
    if parsed > today + timedelta(days=366):
        raise ToolError("The date is too far in the future.")
    return parsed


def _parse_item_ids(raw: Any) -> list[UUID]:
    if not isinstance(raw, list) or not raw:
        raise ToolError("item_ids must be a non-empty list of item ids.")
    ids: list[UUID] = []
    for value in raw[:MAX_OUTFIT_ITEMS]:
        try:
            item_id = UUID(str(value))
        except ValueError:
            raise ToolError(f"Unknown item id: {clean_text(value, 40)}") from None
        if item_id not in ids:
            ids.append(item_id)
    if len(raw) > MAX_OUTFIT_ITEMS:
        raise ToolError(f"An outfit can have at most {MAX_OUTFIT_ITEMS} items.")
    return ids


def normalize_occasion(value: Any) -> str:
    from app.api.outfits import VALID_OCCASIONS

    occ = (clean_text(value, 50) or "casual").lower()
    return occ if occ in VALID_OCCASIONS else "casual"


def _item_brief(item: ClothingItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "name": clean_text(item.name) or clean_text(item.subtype) or item.type,
        "type": item.type,
        "subtype": clean_text(item.subtype, 40),
        "colors": item.colors or ([item.primary_color] if item.primary_color else []),
        "pattern": item.pattern,
        "material": item.material,
        "style": item.style or [],
        "formality": item.formality,
        "season": item.season or [],
        "times_worn": item.wear_count or 0,
        "last_worn": item.last_worn_at.isoformat() if item.last_worn_at else None,
        "needs_wash": bool(item.needs_wash),
        "favorite": bool(item.favorite),
    }


def card_item(item: ClothingItem) -> dict[str, Any]:
    """Snapshot stored in message attachments (paths are signed when served)."""
    return {
        "id": str(item.id),
        "name": clean_text(item.name) or clean_text(item.subtype) or item.type,
        "type": item.type,
        "thumbnail_path": item.thumbnail_path,
        "image_path": item.image_path,
    }


def outfit_card(outfit: Outfit, kind: str = "created") -> dict[str, Any]:
    items = [oi.item for oi in sorted(outfit.items, key=lambda x: x.position) if oi.item]
    return {
        "kind": kind,
        "outfit_id": str(outfit.id),
        "name": clean_text(outfit.name) or clean_text(outfit.reasoning, 80),
        "occasion": outfit.occasion,
        "scheduled_for": outfit.scheduled_for.isoformat() if outfit.scheduled_for else None,
        "items": [card_item(i) for i in items],
    }


async def load_owned_items(
    db: AsyncSession, user_id: UUID, item_ids: list[UUID]
) -> list[ClothingItem]:
    """Ready, non-archived items of this user; raises ToolError if any id is not theirs."""
    result = await db.execute(
        select(ClothingItem).where(
            and_(
                ClothingItem.id.in_(item_ids),
                ClothingItem.user_id == user_id,
                ClothingItem.status == ItemStatus.ready,
                ClothingItem.is_archived.is_(False),
            )
        )
    )
    items = {i.id: i for i in result.scalars().all()}
    missing = [str(i) for i in item_ids if i not in items]
    if missing:
        raise ToolError(
            "These item ids are not in the user's wardrobe: "
            + ", ".join(missing[:5])
            + ". Use ids from get_wardrobe only."
        )
    return [items[i] for i in item_ids]


async def _resolve_location(user: User) -> tuple[float, float] | None:
    lat = float(user.location_lat) if user.location_lat is not None else None
    lon = float(user.location_lon) if user.location_lon is not None else None
    if (lat is None or lon is None) and user.location_name:
        try:
            geocoded = await WeatherService().geocode_location_name(user.location_name)
        except GeocodingServiceError:
            geocoded = None
        if geocoded:
            lat, lon = geocoded[0], geocoded[1]
    if lat is None or lon is None:
        return None
    return lat, lon


# --- Tools -----------------------------------------------------------------------------


async def get_wardrobe(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    try:
        limit = int(args.get("limit") or DEFAULT_WARDROBE_ITEMS)
    except (TypeError, ValueError):
        limit = DEFAULT_WARDROBE_ITEMS
    limit = max(1, min(limit, MAX_WARDROBE_ITEMS))

    clauses = [
        ClothingItem.user_id == ctx.user.id,
        ClothingItem.status == ItemStatus.ready,
        ClothingItem.is_archived.is_(False),
    ]
    if t := clean_text(args.get("type"), 50):
        clauses.append(or_(ClothingItem.type == t.lower(), ClothingItem.subtype.ilike(t)))
    if c := clean_text(args.get("color"), 30):
        c = c.lower()
        clauses.append(or_(ClothingItem.primary_color == c, ClothingItem.colors.any(c)))
    if s := clean_text(args.get("season"), 20):
        clauses.append(
            or_(ClothingItem.season.any(s.lower()), ClothingItem.season.any("all-season"))
        )
    if f := clean_text(args.get("formality"), 30):
        clauses.append(ClothingItem.formality == f.lower())
    if st := clean_text(args.get("style"), 30):
        clauses.append(ClothingItem.style.any(st.lower()))
    if q := clean_text(args.get("search"), 60):
        clauses.append(ClothingItem.name.ilike(f"%{q}%"))
    if args.get("include_needs_wash") is False:
        clauses.append(ClothingItem.needs_wash.is_(False))

    total = (
        await ctx.db.execute(select(func.count()).select_from(ClothingItem).where(and_(*clauses)))
    ).scalar_one()
    result = await ctx.db.execute(
        select(ClothingItem)
        .where(and_(*clauses))
        .order_by(ClothingItem.type, ClothingItem.created_at.desc())
        .limit(limit)
    )
    items = [_item_brief(i) for i in result.scalars().all()]
    return {"total_matching": total, "returned": len(items), "items": items}


async def get_weather(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    today = get_user_today(ctx.user)
    target = _parse_date(args.get("date"), today) or today
    location = await _resolve_location(ctx.user)
    if location is None:
        return {"available": False, "reason": "The user has not set a location in Settings."}
    lat, lon = location
    service = WeatherService()
    try:
        if target == today:
            w = await service.get_current_weather(lat, lon)
            return {
                "available": True,
                "date": today.isoformat(),
                "location": clean_text(ctx.user.location_name),
                "temperature_c": w.temperature,
                "feels_like_c": w.feels_like,
                "condition": w.condition_label or w.condition,
                "precipitation_chance": w.precipitation_chance,
                "wind_kmh": w.wind_speed,
                "humidity": w.humidity,
                "uv_index": w.uv_index,
            }
        days_ahead = (target - today).days
        if days_ahead > 15:
            return {
                "available": False,
                "date": target.isoformat(),
                "reason": "No forecast that far ahead; reason with the typical season "
                "climate for the location instead.",
                "location": clean_text(ctx.user.location_name),
            }
        forecast = await service.get_daily_forecast(lat, lon, days=days_ahead + 1)
        for day in forecast:
            if day.date == target.isoformat():
                return {
                    "available": True,
                    "date": day.date,
                    "location": clean_text(ctx.user.location_name),
                    "temp_min_c": day.temp_min,
                    "temp_max_c": day.temp_max,
                    "condition": day.condition_label or day.condition,
                    "precipitation_chance": day.precipitation_chance,
                }
        return {"available": False, "date": target.isoformat(), "reason": "No forecast."}
    except (WeatherServiceError, ValueError) as e:
        logger.warning("Stinky chat weather lookup failed: %s", type(e).__name__)
        return {"available": False, "reason": "The weather service is not responding."}


async def get_recent_outfits(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    try:
        days = int(args.get("days") or 14)
    except (TypeError, ValueError):
        days = 14
    days = max(1, min(days, MAX_RECENT_DAYS))
    today = get_user_today(ctx.user)
    since = today - timedelta(days=days)
    result = await ctx.db.execute(
        select(Outfit)
        .where(
            and_(
                Outfit.user_id == ctx.user.id,
                or_(
                    and_(Outfit.scheduled_for.is_not(None), Outfit.scheduled_for >= since),
                    and_(Outfit.scheduled_for.is_(None), Outfit.created_at >= since),
                ),
            )
        )
        .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
        .options(selectinload(Outfit.feedback))
        .order_by(Outfit.created_at.desc())
        .limit(20)
    )
    outfits = []
    for o in result.scalars().all():
        items = [oi.item for oi in sorted(o.items, key=lambda x: x.position) if oi.item]
        outfits.append(
            {
                "id": str(o.id),
                "name": clean_text(o.name),
                "date": o.scheduled_for.isoformat() if o.scheduled_for else None,
                "occasion": o.occasion,
                "status": o.status.value,
                "source": o.source.value,
                "worn": bool(o.feedback and o.feedback.worn_at),
                "rating": o.feedback.rating if o.feedback else None,
                "items": [
                    {"id": str(i.id), "name": clean_text(i.name) or i.type, "type": i.type}
                    for i in items
                ],
            }
        )
    return {"days": days, "outfits": outfits}


async def get_listening_mood(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    from app.services import music_source
    from app.services.listening_mood import is_low_mood, mood_sounds

    try:
        sources = await music_source.get_sources(ctx.db, ctx.user.id)
        contrast = await music_source.contrast_enabled(ctx.db, ctx.user.id)
        today = await music_source.todays_music(ctx.db, ctx.user)
    except Exception as e:  # music is optional context: never fail the chat
        logger.warning("Stinky chat music lookup failed: %s", type(e).__name__)
        return {"connected": False, "available": False}
    music_today = (
        {
            "sounds": [mood_sounds(m) for m in today.moods][:2],
            "energy": round(float(today.energy), 2),
            "valence": round(float(today.valence), 2),
            "low": is_low_mood(today.energy, today.valence),
            "genres": [clean_text(g, 40) for g in (today.top_genres or [])][:5],
        }
        if today is not None and today.moods
        else None
    )
    base: dict[str, Any] = {
        "connected": sources.connected,
        "source": sources.primary,
        "contrast": contrast,
        "music_today": music_today,
    }
    if not sources.connected:
        return {**base, "available": music_today is not None}
    mood = None
    if sources.use_for_mood:
        try:
            mood = await music_source.listening_mood(ctx.db, sources)
        except Exception as e:
            logger.warning("Stinky chat listening mood failed: %s", type(e).__name__)
    if mood is None:
        return {**base, "available": music_today is not None}
    return {
        **base,
        "available": True,
        "source": mood.source,
        "listening": mood.listening,
        "artist": clean_text(mood.artist),
        "track": clean_text(mood.track),
        "genres": [clean_text(g, 40) for g in mood.genres][:6],
        "mood_tags": [clean_text(t, 40) for t in mood.tags][:8],
        "top_artists": [clean_text(a, 60) for a in mood.top_artists][:5],
    }


async def get_user_preferences(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    result = await ctx.db.execute(
        select(UserPreference).where(UserPreference.user_id == ctx.user.id)
    )
    prefs = result.scalar_one_or_none()
    data: dict[str, Any] = {
        "location": clean_text(ctx.user.location_name),
        "timezone": ctx.user.timezone,
    }
    # Same Spanish taste summary the Stylist and pairing prompts get.
    data["style_summary"] = format_style_profile_for_prompt(
        prefs, body_measurements=getattr(ctx.user, "body_measurements", None)
    )
    if prefs is None:
        data["preferences_set"] = False
        return data
    style_profile = prefs.style_profile if isinstance(prefs.style_profile, dict) else {}
    data.update(
        {
            "preferences_set": True,
            "favorite_colors": prefs.color_favorites or [],
            "avoid_colors": prefs.color_avoid or [],
            "style_profile": {
                str(clean_text(k, 40)): clean_text(v, 200) for k, v in style_profile.items()
            },
            "default_occasion": prefs.default_occasion,
            "temperature_unit": prefs.temperature_unit,
            "temperature_sensitivity": prefs.temperature_sensitivity,
            "layering_preference": prefs.layering_preference,
        }
    )
    return data


async def show_outfit(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    item_ids = _parse_item_ids(args.get("item_ids"))
    items = await load_owned_items(ctx.db, ctx.user.id, item_ids)
    card = {
        "kind": "proposed",
        "outfit_id": None,
        "name": clean_text(args.get("name")) or None,
        "occasion": normalize_occasion(args.get("occasion")),
        "scheduled_for": None,
        "items": [card_item(i) for i in items],
    }
    ctx.cards.append(card)
    return {"shown": True, "note": "The card is on screen; do not repeat the item ids."}


async def create_outfit(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    item_ids = _parse_item_ids(args.get("item_ids"))
    await load_owned_items(ctx.db, ctx.user.id, item_ids)  # ownership + ready + not archived
    today = get_user_today(ctx.user)
    scheduled = _parse_date(args.get("date"), today)
    outfit = await create_chat_outfit(
        ctx.db,
        ctx.user,
        item_ids,
        name=clean_text(args.get("name"), 100),
        occasion=normalize_occasion(args.get("occasion")),
        scheduled_for=scheduled,
    )
    ctx.cards.append(outfit_card(outfit, "created"))
    ctx.outfit_created = True
    return {
        "created": True,
        "outfit_id": str(outfit.id),
        "date": scheduled.isoformat() if scheduled else None,
        "note": "Saved and shown as a card.",
    }


async def suggest_outfit(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    from app.services.recommendation_service import (
        AIRecommendationError,
        InsufficientWardrobeError,
        RecommendationService,
    )

    today = get_user_today(ctx.user)
    target = _parse_date(args.get("date"), today)
    occasion = normalize_occasion(args.get("occasion"))
    try:
        outfit = await RecommendationService(ctx.db).generate_recommendation(
            user=ctx.user,
            occasion=occasion,
            source=OutfitSource.stinky_chat,
            single_outfit=True,
            scheduled_date=target,
        )
    except InsufficientWardrobeError:
        raise ToolError("The wardrobe has too few items for a full outfit.") from None
    except AIDisabledError:
        raise ToolError("The stylist engine is not available right now.") from None
    except AIRecommendationError:
        raise ToolError("The stylist engine could not build an outfit this time.") from None
    except ValueError as e:
        raise ToolError(clean_text(str(e), 200) or "Could not suggest an outfit.") from None
    ctx.cards.append(outfit_card(outfit, "created"))
    ctx.outfit_created = True
    items = [oi.item for oi in sorted(outfit.items, key=lambda x: x.position) if oi.item]
    return {
        "created": True,
        "outfit_id": str(outfit.id),
        "occasion": occasion,
        "headline": clean_text(outfit.reasoning, 200),
        "styling_tip": clean_text(outfit.style_notes, 300),
        "items": [{"id": str(i.id), "name": clean_text(i.name) or i.type} for i in items],
        "note": "Shown as a card; comment on it briefly.",
    }


async def _check_memory_budget(ctx: ToolContext) -> None:
    """Stinky may not turn a conversation into a note-taking machine."""
    if ctx.memory_writes >= MAX_MEMORY_WRITES_PER_TURN:
        raise ToolError(
            "You have already noted enough in this message. Keep talking; note the rest later."
        )
    if ctx.conversation_id is None:
        return
    from fastapi import HTTPException

    from app.utils.rate_limit import rate_limit_by_user

    try:
        await rate_limit_by_user(
            ctx.conversation_id,
            "stinky_memory_conv",
            max_requests=MAX_MEMORY_WRITES_PER_CONVERSATION,
            window_seconds=MEMORY_WRITE_WINDOW_SECONDS,
        )
    except HTTPException:
        raise ToolError(
            "You have written too many notes in this conversation. Carry on without noting."
        ) from None


async def remember(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    await _check_memory_budget(ctx)
    try:
        memory, action = await stinky_memory.remember(
            ctx.db,
            ctx.user.id,
            str(args.get("kind") or ""),
            str(args.get("text") or ""),
            source="chat",
        )
    except stinky_memory.MemoryRefused as e:
        raise ToolError(str(e)) from None
    await ctx.db.commit()
    ctx.memory_writes += 1
    if action != "unchanged":
        ctx.notes.append({"kind": memory.kind, "text": memory.text, "action": action})
    return {
        "saved": True,
        "action": action,
        "id": str(memory.id),
        "kind": memory.kind,
        "text": memory.text,
        "total": await stinky_memory.count_memories(ctx.db, ctx.user.id),
        "max_total": MAX_MEMORIES_PER_USER,
        "note": (
            "Saved. The user can see and edit it in Ajustes → Stinky recuerda. Do not "
            "recite the note back; just keep talking naturally."
        ),
    }


async def forget(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    memory_id: UUID | None = None
    raw_id = args.get("id")
    if raw_id not in (None, ""):
        try:
            memory_id = UUID(str(raw_id))
        except ValueError:
            raise ToolError("That is not a note id. Pass the note's text instead.") from None
    try:
        removed = await stinky_memory.forget(
            ctx.db, ctx.user.id, memory_id=memory_id, text=args.get("text")
        )
    except stinky_memory.MemoryRefused as e:
        raise ToolError(str(e)) from None
    await ctx.db.commit()
    if removed:
        ctx.notes.append({"kind": "forgotten", "text": removed[0], "action": "deleted"})
    return {"forgotten": len(removed), "texts": removed[:5]}


async def create_chat_outfit(
    db: AsyncSession,
    user: User,
    item_ids: list[UUID],
    *,
    name: str | None,
    occasion: str,
    scheduled_for: date | None,
) -> Outfit:
    """Create an outfit from owned items with source ``stinky_chat`` (commits)."""
    try:
        outfit = await StudioService(db).create_from_scratch(
            user=user,
            item_ids=item_ids,
            occasion=occasion,
            name=name,
            scheduled_for=scheduled_for,
            mark_worn=False,
            source_item_id=None,
            source=OutfitSource.stinky_chat,
            synthetic_feedback=False,
        )
    except (ItemOwnershipError, ValueError):
        raise ToolError("Some items are not in the user's wardrobe.") from None
    await db.commit()
    return outfit


ToolFn = Callable[[ToolContext, dict[str, Any]], Awaitable[dict[str, Any]]]

TOOLS: dict[str, ToolFn] = {
    "get_wardrobe": get_wardrobe,
    "get_weather": get_weather,
    "get_recent_outfits": get_recent_outfits,
    "get_listening_mood": get_listening_mood,
    "get_user_preferences": get_user_preferences,
    "show_outfit": show_outfit,
    "create_outfit": create_outfit,
    "suggest_outfit": suggest_outfit,
    "remember": remember,
    "forget": forget,
}
assert set(TOOLS) == TOOL_NAMES


def _dump(payload: dict[str, Any]) -> str:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = json.dumps(
            {"ok": False, "error": "Result too large; use narrower filters."}, ensure_ascii=False
        )
    return text


async def _recover_session(ctx: ToolContext) -> None:
    """Roll back a failed unit of work and reload the user (rollback expires it)."""
    try:
        await ctx.db.rollback()
        await ctx.db.refresh(ctx.user)
        await ctx.db.refresh(ctx.user, ["preferences"])
    except Exception:
        logger.warning("Stinky chat could not recover the DB session", exc_info=True)


async def run_tool(ctx: ToolContext, name: str, raw_arguments: str) -> str:
    """Execute one tool call and return the JSON string sent back to the model."""
    fn = TOOLS.get(name)
    if fn is None:
        return _dump({"ok": False, "error": f"Unknown tool {clean_text(name, 40)}."})
    try:
        args = json.loads(raw_arguments) if raw_arguments and raw_arguments.strip() else {}
    except json.JSONDecodeError:
        return _dump({"ok": False, "error": "Arguments were not valid JSON."})
    if not isinstance(args, dict):
        return _dump({"ok": False, "error": "Arguments must be a JSON object."})
    try:
        data = await fn(ctx, args)
    except ToolError as e:
        return _dump({"ok": False, "error": str(e)})
    except Exception:
        logger.exception("Stinky chat tool %s failed", name)
        await _recover_session(ctx)
        return _dump({"ok": False, "error": "Internal error running this tool."})
    return _dump({"ok": True, "data": data})
