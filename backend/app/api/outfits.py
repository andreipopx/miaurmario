import logging
from datetime import UTC, date, datetime, time
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import get_db
from app.models.item import ClothingItem
from app.models.outfit import (
    FamilyOutfitRating,
    Outfit,
    OutfitItem,
    OutfitStatus,
    OutfitVisibility,
    RatingScope,
    UserFeedback,
)
from app.models.user import User
from app.schemas.item import DEFAULT_WASH_INTERVALS, GarmentPhoto, ImageViewName
from app.services.ai_access import AIAccessError, ai_error_detail
from app.services.ai_service import AIDisabledError
from app.services.avatar_service import avatar_thumb_url
from app.services.item_rescue import ItemRescueService
from app.services.item_service import ItemService
from app.services.learning_service import LearningService
from app.services.outfit_service import OutfitListFilters, OutfitService
from app.services.recommendation_service import (
    AIRecommendationError,
    InsufficientWardrobeError,
    RecommendationService,
)
from app.services.social_service import apply_visibility, share_with_friends
from app.services.studio_service import (
    ItemLayoutInput,
    ItemOwnershipError,
    OutfitNotTemplateError,
    OutfitWornImmutableError,
    StudioService,
)
from app.services.suggestion_cache import clear_suggestions
from app.services.weather_service import (
    WeatherData,
    wmo_code_for_condition,
    wmo_condition_label_es,
)
from app.utils.auth import get_current_user
from app.utils.error_codes import code_of, error_detail
from app.utils.image_formats import is_cutout_path
from app.utils.image_views import back_photo_paths, normalize_image_view
from app.utils.occasions import VALID_OCCASIONS  # re-exported: imported elsewhere
from app.utils.rate_limit import rate_limit_by_user
from app.utils.signed_urls import sign_image_url

logger = logging.getLogger(__name__)


def get_user_today(user: User) -> date:
    try:
        user_tz = ZoneInfo(user.timezone or "UTC")
    except Exception:
        user_tz = ZoneInfo("UTC")
    return datetime.now(UTC).astimezone(user_tz).date()


router = APIRouter(prefix="/outfits", tags=["Outfits"])


class WeatherOverrideRequest(BaseModel):
    temperature: float = Field(description="Temperature in Celsius")
    feels_like: float | None = Field(None, description="Feels like temperature")
    condition: str = Field(default="unknown", description="Weather condition")
    precipitation_chance: int = Field(default=0, ge=0, le=100)
    humidity: int = Field(default=50, ge=0, le=100)


class SuggestRequest(BaseModel):
    occasion: str | None = None

    @field_validator("occasion")
    @classmethod
    def validate_occasion(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if len(v) > 50:
            raise ValueError("Occasion must be 50 characters or less")
        if v not in VALID_OCCASIONS:
            raise ValueError(
                f"Invalid occasion '{v}'. Must be one of: {', '.join(sorted(VALID_OCCASIONS))}"
            )
        return v

    time_of_day: Literal["morning", "afternoon", "evening", "night", "full day"] | None = None
    weather_override: WeatherOverrideRequest | None = None
    exclude_items: list[UUID] = Field(default_factory=list, description="Items to exclude")
    include_items: list[UUID] = Field(default_factory=list, description="Items to include")
    song_query: str | None = Field(
        default=None,
        max_length=300,
        description=(
            "Optional song reference (free text or Spotify URL). The Stylist will "
            "use the song's mood/tags as an extra styling input."
        ),
    )
    song_track_id: str | None = Field(
        default=None,
        pattern=r"^[A-Za-z0-9]{10,40}$",
        description=(
            "Exact Spotify track id picked from /music/search. When set, the Stylist "
            "uses that track directly instead of resolving `song_query` as text."
        ),
    )

    @field_validator("song_query")
    @classmethod
    def _clean_song_query(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class OutfitItemResponse(BaseModel):
    id: UUID
    type: str
    subtype: str | None = None
    name: str | None = None
    primary_color: str | None = None
    colors: list[str] = []
    image_path: str | None = None
    thumbnail_path: str | None = None
    #: Which side of the garment `image_path` shows. Almost always "front"; a
    #: garment whose only photo is its back says so here.
    image_view: ImageViewName = "front"
    #: This garment seen from behind, or null when nobody photographed its back.
    #: What "ver por detrás" swaps to, and what decides whether that toggle is
    #: offered at all: a look where no garment has one never shows it.
    back_image: GarmentPhoto | None = None
    layer_type: str | None = None
    position: int
    # Free-form canvas layout (null pos_x/pos_y means "no spatial layout, fall back to grid")
    pos_x: float | None = None
    pos_y: float | None = None
    scale: float = 1.0
    rotation: float = 0.0
    z_index: int = 0

    @computed_field
    @property
    def image_url(self) -> str | None:
        if self.image_path:
            return sign_image_url(self.image_path)
        return None

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        if self.thumbnail_path:
            return sign_image_url(self.thumbnail_path)
        return None

    @computed_field
    @property
    def has_cutout(self) -> bool:
        """True when the stored image keeps its transparency.

        Per photo, not per garment: `back_image` carries its own answer, because
        each photo of a garment has its background removed on its own.

        The flat lay is the screen that most needs to know: a real cut-out floats
        on the look's tint with a shadow the shape of the garment, while a photo
        with white baked in has to be clipped to a tile or it reads as a stray
        white rectangle over the others.
        """
        return is_cutout_path(self.thumbnail_path or self.image_path)


class WoreInsteadItem(BaseModel):
    id: UUID
    type: str
    name: str | None = None
    thumbnail_path: str | None = None

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        if self.thumbnail_path:
            return sign_image_url(self.thumbnail_path)
        return None


class FeedbackSummary(BaseModel):
    rating: int | None = None
    comment: str | None = None
    worn_at: date | None = None
    actually_worn: bool | None = None
    wore_instead_items: list[WoreInsteadItem] | None = None


class FamilyRatingRequest(BaseModel):
    rating: int = Field(ge=1, le=5, description="Rating 1-5")
    comment: str | None = Field(None, max_length=500)


class FamilyRatingResponse(BaseModel):
    id: UUID
    user_id: UUID
    user_display_name: str
    user_avatar_url: str | None = None
    rating: int
    comment: str | None = None
    created_at: datetime


class MusicInspiration(BaseModel):
    artist: str | None = None
    track: str | None = None
    label: str
    tags: list[str] = Field(default_factory=list)


class OutfitResponse(BaseModel):
    id: UUID
    occasion: str
    scheduled_for: date | None = None
    status: str
    name: str | None = None
    replaces_outfit_id: UUID | None = None
    cloned_from_outfit_id: UUID | None = None
    source: str
    reasoning: str | None = None
    style_notes: str | None = None
    highlights: list[str] | None = None
    weather: dict | None = None
    items: list[OutfitItemResponse]
    feedback: FeedbackSummary | None = None
    family_ratings: list[FamilyRatingResponse] | None = None
    family_rating_average: float | None = None
    family_rating_count: int | None = None
    is_starter_suggestion: bool = False
    music_inspiration: MusicInspiration | None = None
    visibility: OutfitVisibility = OutfitVisibility.private
    shared_at: datetime | None = None
    # Day moment ("Momentos del día"); order 0 with no label = the day's default look.
    moment_order: int = 0
    moment_label: str | None = None
    moment_time: time | None = None
    transition_from_outfit_id: UUID | None = None
    created_at: datetime


class OutfitListResponse(BaseModel):
    outfits: list[OutfitResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


class FeedbackRequest(BaseModel):
    accepted: bool | None = Field(None, description="Whether outfit was accepted")
    rating: int | None = Field(None, ge=1, le=5, description="Overall rating 1-5")
    comfort_rating: int | None = Field(None, ge=1, le=5, description="Comfort rating 1-5")
    style_rating: int | None = Field(None, ge=1, le=5, description="Style rating 1-5")
    comment: str | None = Field(None, max_length=1000, description="Optional comment")
    worn: bool | None = Field(None, description="Whether the outfit was worn")
    worn_with_modifications: bool | None = Field(
        None, description="If worn, whether modifications were made"
    )
    modification_notes: str | None = Field(None, max_length=500)
    actually_worn: bool | None = Field(
        None, description="Did user actually wear this recommendation?"
    )
    wore_instead_items: list[UUID] | None = Field(
        None, description="Item IDs user wore instead of recommendation"
    )


class FeedbackResponse(BaseModel):
    id: UUID
    outfit_id: UUID
    accepted: bool | None = None
    rating: int | None = None
    comfort_rating: int | None = None
    style_rating: int | None = None
    comment: str | None = None
    worn_at: date | None = None
    worn_with_modifications: bool = False
    modification_notes: str | None = None
    actually_worn: bool | None = None
    wore_instead_items: list[UUID] | None = None
    created_at: datetime


async def fetch_wore_instead_items_map(
    db: AsyncSession, outfits: list[Outfit], user_id: UUID | None = None
) -> dict[str, list[WoreInsteadItem]]:
    all_item_ids: set[UUID] = set()
    outfit_to_item_ids: dict[str, list[str]] = {}

    for outfit in outfits:
        if outfit.feedback and outfit.feedback.wore_instead_items:
            item_ids: list[str] = []
            for item_data in outfit.feedback.wore_instead_items:
                try:
                    if isinstance(item_data, dict):
                        item_id = item_data.get("item_id", "")
                    else:
                        item_id = str(item_data)
                    if item_id:
                        item_ids.append(item_id)
                        all_item_ids.add(UUID(item_id))
                except (ValueError, TypeError, KeyError):
                    continue
            outfit_to_item_ids[str(outfit.id)] = item_ids

    if not all_item_ids:
        return {}

    query = select(ClothingItem).where(ClothingItem.id.in_(all_item_ids))
    if user_id is not None:
        query = query.where(ClothingItem.user_id == user_id)
    result = await db.execute(query)
    items_by_id = {str(item.id): item for item in result.scalars().all()}

    wore_instead_map: dict[str, list[WoreInsteadItem]] = {}
    for outfit_id, item_ids in outfit_to_item_ids.items():
        wore_items = []
        for item_id in item_ids:
            if item_id in items_by_id:
                item = items_by_id[item_id]
                wore_items.append(
                    WoreInsteadItem(
                        id=item.id,
                        type=item.type,
                        name=item.name,
                        thumbnail_path=item.thumbnail_path,
                    )
                )
        if wore_items:
            wore_instead_map[outfit_id] = wore_items

    return wore_instead_map


def _rater_name(user: User | None) -> str:
    # Never fall back to the email: it is private.
    if user is None:
        return "Unknown"
    return user.display_name or user.username or "Unknown"


def _back_photo(item: ClothingItem) -> GarmentPhoto | None:
    """The garment's back photo, ready to render, or None if there is not one."""
    paths = back_photo_paths(item)
    if paths is None:
        return None
    return GarmentPhoto(image_path=paths[0], thumbnail_path=paths[1])


def outfit_to_response(
    outfit: Outfit,
    wore_instead_items_map: dict[str, list[WoreInsteadItem]] | None = None,
    is_starter_suggestion: bool = False,
) -> OutfitResponse:
    items = []
    for outfit_item in sorted(outfit.items, key=lambda x: x.position):
        item = outfit_item.item
        items.append(
            OutfitItemResponse(
                id=item.id,
                type=item.type,
                subtype=item.subtype,
                name=item.name,
                primary_color=item.primary_color,
                colors=item.colors or [],
                image_path=item.image_path,
                thumbnail_path=item.thumbnail_path,
                image_view=normalize_image_view(item.image_view),
                back_image=_back_photo(item),
                layer_type=outfit_item.layer_type,
                position=outfit_item.position,
                pos_x=outfit_item.pos_x,
                pos_y=outfit_item.pos_y,
                scale=outfit_item.scale if outfit_item.scale is not None else 1.0,
                rotation=outfit_item.rotation if outfit_item.rotation is not None else 0.0,
                z_index=outfit_item.z_index if outfit_item.z_index is not None else 0,
            )
        )

    feedback_summary = None
    if outfit.feedback:
        wore_instead = None
        if wore_instead_items_map and str(outfit.id) in wore_instead_items_map:
            wore_instead = wore_instead_items_map[str(outfit.id)]
        feedback_summary = FeedbackSummary(
            rating=outfit.feedback.rating,
            comment=outfit.feedback.comment,
            worn_at=outfit.feedback.worn_at,
            actually_worn=outfit.feedback.actually_worn,
            wore_instead_items=wore_instead,
        )

    highlights = None
    music_inspiration = None
    if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
        raw_highlights = outfit.ai_raw_response.get("highlights")
        if raw_highlights and isinstance(raw_highlights, list):
            highlights = raw_highlights
        raw_music = outfit.ai_raw_response.get("_music_inspiration")
        if isinstance(raw_music, dict) and raw_music.get("label"):
            music_inspiration = MusicInspiration(
                artist=raw_music.get("artist"),
                track=raw_music.get("track"),
                label=raw_music["label"],
                tags=raw_music.get("tags") or [],
            )

    family_ratings_list = None
    family_rating_average = None
    family_rating_count = None
    # Only family-scope ratings here: family members can list each other's outfits and
    # must not see the owner's friends' reactions (those live under /social).
    family_scope = [
        r for r in (outfit.family_ratings or []) if r.scope in (None, RatingScope.family)
    ]
    if family_scope:
        family_ratings_list = [
            FamilyRatingResponse(
                id=r.id,
                user_id=r.user_id,
                user_display_name=_rater_name(r.user),
                user_avatar_url=avatar_thumb_url(r.user),
                rating=r.rating,
                comment=r.comment,
                created_at=r.created_at,
            )
            for r in family_scope
        ]
        family_rating_count = len(family_scope)
        family_rating_average = sum(r.rating for r in family_scope) / family_rating_count

    return OutfitResponse(
        id=outfit.id,
        occasion=outfit.occasion,
        scheduled_for=outfit.scheduled_for,
        status=outfit.status.value,
        name=outfit.name,
        replaces_outfit_id=outfit.replaces_outfit_id,
        cloned_from_outfit_id=outfit.cloned_from_outfit_id,
        source=outfit.source.value,
        reasoning=outfit.reasoning,
        style_notes=outfit.style_notes,
        highlights=highlights,
        weather=outfit.weather_data,
        items=items,
        feedback=feedback_summary,
        family_ratings=family_ratings_list,
        family_rating_average=family_rating_average,
        family_rating_count=family_rating_count,
        is_starter_suggestion=is_starter_suggestion,
        music_inspiration=music_inspiration,
        visibility=outfit.visibility or OutfitVisibility.private,
        shared_at=outfit.shared_at,
        moment_order=outfit.moment_order or 0,
        moment_label=outfit.moment_label,
        moment_time=outfit.moment_time,
        transition_from_outfit_id=outfit.transition_from_outfit_id,
        created_at=outfit.created_at,
    )


@router.post("/suggest", response_model=OutfitResponse)
async def suggest_outfit(
    request: SuggestRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    await rate_limit_by_user(str(current_user.id), "suggest", max_requests=10, window_seconds=60)
    weather_override = None
    if request.weather_override:
        w = request.weather_override
        override_code = wmo_code_for_condition(w.condition)
        weather_override = WeatherData(
            temperature=w.temperature,
            feels_like=w.feels_like or w.temperature,
            humidity=w.humidity,
            precipitation_chance=w.precipitation_chance,
            precipitation_mm=0,
            wind_speed=0,
            condition=w.condition,
            condition_code=override_code if override_code is not None else 0,
            is_day=True,
            uv_index=0,
            timestamp=datetime.utcnow(),
            condition_label=(
                wmo_condition_label_es(override_code) if override_code is not None else None
            ),
        )

    service = RecommendationService(db)

    occasion = request.occasion
    if occasion is None:
        if current_user.preferences and current_user.preferences.default_occasion:
            occasion = current_user.preferences.default_occasion
        else:
            occasion = "casual"

    try:
        outfit = await service.generate_recommendation(
            user=current_user,
            occasion=occasion,
            weather_override=weather_override,
            exclude_items=request.exclude_items,
            include_items=request.include_items,
            time_of_day=request.time_of_day,
            song_query=request.song_query,
            song_track_id=request.song_track_id,
        )
    except InsufficientWardrobeError as e:
        logger.info(f"Suggestion refused: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail("insufficient_wardrobe"),
        ) from None
    except AIAccessError as e:
        code, detail = ai_error_detail(e)
        raise HTTPException(status_code=code, detail=detail) from None
    except AIDisabledError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error_detail("ai_internal_disabled"),
        ) from None
    except AIRecommendationError as e:
        logger.error(f"AI recommendation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error_detail("ai_recommendation_failed"),
        ) from None
    except ValueError as e:
        logger.info(f"Suggestion rejected: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail(code_of(e, "invalid_request")),
        ) from None

    item_service = ItemService(db)
    total_items = await item_service.get_ready_item_count(current_user.id)
    is_starter = total_items <= 5

    wore_instead_map = await fetch_wore_instead_items_map(db, [outfit], user_id=current_user.id)
    return outfit_to_response(outfit, wore_instead_map, is_starter_suggestion=is_starter)


class RescueRequest(BaseModel):
    """«Rescátala»: a look built around one garment the owner never reaches for."""

    item_id: UUID
    occasion: str | None = None

    @field_validator("occasion")
    @classmethod
    def validate_occasion(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if v not in VALID_OCCASIONS:
            raise ValueError(
                f"Invalid occasion '{v}'. Must be one of: {', '.join(sorted(VALID_OCCASIONS))}"
            )
        return v


class RescueHintResponse(BaseModel):
    """A plain reason, as a code the frontend turns into a sentence."""

    code: str
    value: str | None = None


class RescueResponse(BaseModel):
    rescued: bool
    #: "ai" or "heuristic" when a look came out; None otherwise.
    engine: Literal["ai", "heuristic"] | None = None
    outfit: OutfitResponse | None = None
    #: "item_unavailable" | "no_combination" when nothing could be built.
    reason: str | None = None
    hints: list[RescueHintResponse] = Field(default_factory=list)


@router.post("/rescue", response_model=RescueResponse)
async def rescue_item(
    request: RescueRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> RescueResponse:
    """Build a look around one garment, or say plainly why it cannot be done.

    The AI stylist when the user has one, the heuristic composer otherwise; the
    garment is pinned either way.
    """
    await rate_limit_by_user(str(current_user.id), "rescue", max_requests=10, window_seconds=60)

    item_service = ItemService(db)
    item = await item_service.get_by_id(request.item_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=error_detail("item_not_found"),
        )

    occasion = request.occasion
    if occasion is None:
        if current_user.preferences and current_user.preferences.default_occasion:
            occasion = current_user.preferences.default_occasion
        else:
            occasion = "casual"

    result = await ItemRescueService(db).rescue(current_user, item, occasion)

    if result.outfit is None:
        return RescueResponse(
            rescued=False,
            reason=result.reason,
            hints=[RescueHintResponse(code=h.code, value=h.value) for h in result.hints],
        )

    wore_instead_map = await fetch_wore_instead_items_map(
        db, [result.outfit], user_id=current_user.id
    )
    return RescueResponse(
        rescued=True,
        engine=result.engine,
        outfit=outfit_to_response(result.outfit, wore_instead_map),
    )


@router.get("", response_model=OutfitListResponse)
async def list_outfits(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    occasion: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    family_member_id: UUID | None = Query(None, description="View a family member's outfits"),
    source: str | None = Query(None, description="Comma-separated source enum filter"),
    is_lookbook: bool | None = Query(None, description="true for templates only"),
    is_replacement: bool | None = Query(None),
    has_source_item: bool | None = Query(None),
    item_type: str | None = Query(None),
    source_type: str | None = Query(
        None, description="Legacy alias for item_type used by /pairings"
    ),
    search: str | None = Query(None, max_length=50),
    cloned_from_outfit_id: UUID | None = Query(
        None, description="Filter to wear instances of a specific template"
    ),
    was_worn: bool | None = Query(
        None, description="true: only outfits marked as worn; false: never worn"
    ),
) -> OutfitListResponse:
    service = OutfitService(db)

    target_user_id = current_user.id
    if family_member_id:
        target_user_id = await service.verify_family_access(current_user, family_member_id)

    filters = OutfitListFilters(
        user_id=target_user_id,
        status_filter=status_filter,
        occasion=occasion,
        date_from=date_from,
        date_to=date_to,
        source=source,
        is_lookbook=is_lookbook,
        is_replacement=is_replacement,
        has_source_item=has_source_item,
        item_type=item_type or source_type,
        family_member_view=family_member_id is not None,
        search=search,
        cloned_from_outfit_id=cloned_from_outfit_id,
        was_worn=was_worn,
    )

    outfits, total = await service.list_with_filters(filters, page, page_size)

    wore_instead_map = await fetch_wore_instead_items_map(db, outfits, user_id=current_user.id)

    outfit_responses = [outfit_to_response(o, wore_instead_map) for o in outfits]

    return OutfitListResponse(
        outfits=outfit_responses,
        total=total,
        page=page,
        page_size=page_size,
        has_more=(page * page_size) < total,
    )


@router.get("/{outfit_id}", response_model=OutfitResponse)
async def get_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.items)
            .selectinload(OutfitItem.item)
            .selectinload(ClothingItem.additional_images),
            selectinload(Outfit.feedback),
            selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )

    return outfit_to_response(
        outfit, await fetch_wore_instead_items_map(db, [outfit], user_id=current_user.id)
    )


@router.post("/{outfit_id}/accept", response_model=OutfitResponse)
async def accept_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.items)
            .selectinload(OutfitItem.item)
            .selectinload(ClothingItem.additional_images),
            selectinload(Outfit.feedback),
            selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )

    outfit.status = OutfitStatus.accepted
    outfit.responded_at = datetime.utcnow()
    await db.commit()
    await db.refresh(outfit)

    return outfit_to_response(
        outfit, await fetch_wore_instead_items_map(db, [outfit], user_id=current_user.id)
    )


@router.post("/{outfit_id}/reject", response_model=OutfitResponse)
async def reject_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.items)
            .selectinload(OutfitItem.item)
            .selectinload(ClothingItem.additional_images),
            selectinload(Outfit.feedback),
            selectinload(Outfit.family_ratings).selectinload(FamilyOutfitRating.user),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )

    outfit.status = OutfitStatus.rejected
    outfit.responded_at = datetime.utcnow()
    await db.commit()
    await db.refresh(outfit)

    await clear_suggestions(current_user.id, outfit.occasion)

    return outfit_to_response(
        outfit, await fetch_wore_instead_items_map(db, [outfit], user_id=current_user.id)
    )


@router.post("/{outfit_id}/skip", response_model=OutfitResponse)
async def skip_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    service = OutfitService(db)
    outfit = await service.set_status(outfit_id, current_user.id, OutfitStatus.skipped)
    await clear_suggestions(current_user.id, outfit.occasion)
    return outfit_to_response(
        outfit, await fetch_wore_instead_items_map(db, [outfit], user_id=current_user.id)
    )


@router.delete("/{outfit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    query = select(Outfit).where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )

    await db.delete(outfit)
    await db.commit()


@router.post("/{outfit_id}/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    outfit_id: UUID,
    request: FeedbackRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FeedbackResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.feedback),
            selectinload(Outfit.items)
            .selectinload(OutfitItem.item)
            .selectinload(ClothingItem.additional_images),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )

    if outfit.feedback:
        feedback = outfit.feedback
    else:
        feedback = UserFeedback(outfit_id=outfit.id)
        outfit.feedback = feedback
        db.add(feedback)

    if request.accepted is not None:
        feedback.accepted = request.accepted
        outfit.status = OutfitStatus.accepted if request.accepted else OutfitStatus.rejected
        outfit.responded_at = datetime.utcnow()

    if request.rating is not None:
        feedback.rating = request.rating
    if request.comfort_rating is not None:
        feedback.comfort_rating = request.comfort_rating
    if request.style_rating is not None:
        feedback.style_rating = request.style_rating
    if request.comment is not None:
        feedback.comment = request.comment
    if request.worn and not feedback.worn_at:
        user_today = get_user_today(current_user)
        feedback.worn_at = user_today
        # Day moments: a piece carried over from this morning's look into the evening
        # one (a transition) is one wear, not two.
        already_worn_today = set(
            (
                await db.execute(
                    select(OutfitItem.item_id)
                    .join(Outfit, Outfit.id == OutfitItem.outfit_id)
                    .join(UserFeedback, UserFeedback.outfit_id == Outfit.id)
                    .where(
                        Outfit.user_id == current_user.id,
                        Outfit.id != outfit.id,
                        UserFeedback.worn_at == user_today,
                    )
                )
            )
            .scalars()
            .all()
        )
        for outfit_item in outfit.items:
            item = outfit_item.item
            if item.id in already_worn_today:
                continue
            effective_interval = (
                item.wash_interval
                if item.wash_interval is not None
                else DEFAULT_WASH_INTERVALS.get(item.type, 3)
            )
            await db.execute(
                update(ClothingItem)
                .where(ClothingItem.id == item.id)
                .values(
                    wear_count=ClothingItem.wear_count + 1,
                    last_worn_at=user_today,
                    wears_since_wash=ClothingItem.wears_since_wash + 1,
                    needs_wash=ClothingItem.wears_since_wash + 1 >= effective_interval,
                )
            )
    if request.worn_with_modifications is not None:
        feedback.worn_with_modifications = request.worn_with_modifications
    if request.modification_notes is not None:
        feedback.modification_notes = request.modification_notes
    if request.actually_worn is not None:
        feedback.actually_worn = request.actually_worn
    if request.wore_instead_items is not None:
        feedback.wore_instead_items = [str(item_id) for item_id in request.wore_instead_items]
        if request.wore_instead_items:
            studio_service = StudioService(db)
            try:
                await studio_service.create_wore_instead(
                    user=current_user,
                    original_outfit_id=outfit_id,
                    item_ids=list(request.wore_instead_items),
                    rating=request.rating,
                    comment=request.comment,
                    scheduled_for=None,
                )
            except ItemOwnershipError:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error_code": "OUTFIT_ITEM_OWNERSHIP",
                        "message": "One or more items do not belong to you",
                    },
                ) from None

    await db.commit()
    await db.refresh(feedback)

    try:
        learning_service = LearningService(db)
        await learning_service.process_feedback(outfit_id, current_user.id)
        logger.info(f"Learning processed for outfit {outfit_id}")
    except Exception as e:
        logger.exception(f"Learning processing failed for outfit {outfit_id}: {e}")

    return FeedbackResponse(
        id=feedback.id,
        outfit_id=feedback.outfit_id,
        accepted=feedback.accepted,
        rating=feedback.rating,
        comfort_rating=feedback.comfort_rating,
        style_rating=feedback.style_rating,
        comment=feedback.comment,
        worn_at=feedback.worn_at,
        worn_with_modifications=feedback.worn_with_modifications,
        modification_notes=feedback.modification_notes,
        actually_worn=feedback.actually_worn,
        wore_instead_items=[UUID(item_id) for item_id in (feedback.wore_instead_items or [])],
        created_at=feedback.created_at,
    )


@router.get("/{outfit_id}/feedback", response_model=FeedbackResponse)
async def get_feedback(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FeedbackResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(selectinload(Outfit.feedback))
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )

    if not outfit.feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No feedback found for this outfit",
        )

    feedback = outfit.feedback
    return FeedbackResponse(
        id=feedback.id,
        outfit_id=feedback.outfit_id,
        accepted=feedback.accepted,
        rating=feedback.rating,
        comfort_rating=feedback.comfort_rating,
        style_rating=feedback.style_rating,
        comment=feedback.comment,
        worn_at=feedback.worn_at,
        worn_with_modifications=feedback.worn_with_modifications,
        modification_notes=feedback.modification_notes,
        actually_worn=feedback.actually_worn,
        wore_instead_items=[UUID(item_id) for item_id in (feedback.wore_instead_items or [])],
        created_at=feedback.created_at,
    )


@router.post("/{outfit_id}/family-rating", response_model=FamilyRatingResponse)
async def submit_family_rating(
    outfit_id: UUID,
    request: FamilyRatingRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FamilyRatingResponse:
    result = await db.execute(select(Outfit).where(Outfit.id == outfit_id))
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outfit not found")

    if outfit.scheduled_for is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "OUTFIT_IS_TEMPLATE",
                "message": "Cannot rate a lookbook template",
            },
        )

    if outfit.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot rate your own outfit",
        )

    if not current_user.family_id or not outfit.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "You must be in the same family to rate outfits",
                "error_code": "NOT_IN_FAMILY",
            },
        )

    owner_result = await db.execute(
        select(User).where(User.id == outfit.user_id, User.is_active == True)  # noqa: E712
    )
    owner = owner_result.scalar_one_or_none()
    if not owner or owner.family_id != current_user.family_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "You must be in the same family to rate outfits",
                "error_code": "NOT_IN_FAMILY",
            },
        )

    existing = await db.execute(
        select(FamilyOutfitRating).where(
            and_(
                FamilyOutfitRating.outfit_id == outfit_id,
                FamilyOutfitRating.user_id == current_user.id,
            )
        )
    )
    rating = existing.scalar_one_or_none()

    if rating:
        rating.rating = request.rating
        rating.comment = request.comment
        rating.scope = RatingScope.family
    else:
        rating = FamilyOutfitRating(
            outfit_id=outfit_id,
            user_id=current_user.id,
            rating=request.rating,
            comment=request.comment,
            scope=RatingScope.family,
        )
        db.add(rating)

    await db.flush()
    await db.refresh(rating)

    return FamilyRatingResponse(
        id=rating.id,
        user_id=rating.user_id,
        user_display_name=_rater_name(current_user),
        user_avatar_url=avatar_thumb_url(current_user),
        rating=rating.rating,
        comment=rating.comment,
        created_at=rating.created_at,
    )


@router.get("/{outfit_id}/family-ratings", response_model=list[FamilyRatingResponse])
async def get_family_ratings(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[FamilyRatingResponse]:
    result = await db.execute(select(Outfit).where(Outfit.id == outfit_id))
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outfit not found")

    if outfit.user_id != current_user.id:
        if not current_user.family_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        owner_result = await db.execute(
            select(User).where(User.id == outfit.user_id, User.is_active == True)  # noqa: E712
        )
        owner = owner_result.scalar_one_or_none()
        if not owner or owner.family_id != current_user.family_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    ratings_result = await db.execute(
        select(FamilyOutfitRating)
        .where(
            FamilyOutfitRating.outfit_id == outfit_id,
            FamilyOutfitRating.scope == RatingScope.family,
        )
        .options(selectinload(FamilyOutfitRating.user))
        .order_by(FamilyOutfitRating.created_at.desc())
    )
    ratings = list(ratings_result.scalars().all())

    return [
        FamilyRatingResponse(
            id=r.id,
            user_id=r.user_id,
            user_display_name=_rater_name(r.user),
            user_avatar_url=avatar_thumb_url(r.user),
            rating=r.rating,
            comment=r.comment,
            created_at=r.created_at,
        )
        for r in ratings
    ]


def _check_studio_kill_switch() -> None:
    if get_settings().studio_disabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "STUDIO_UNAVAILABLE",
                "message": "Studio is temporarily unavailable. AI features still work.",
            },
        )


class StudioItemLayout(BaseModel):
    """Position + transform of a single item on the outfit canvas.

    Coordinates are normalized [0..1] relative to the canvas box, so they stay
    correct regardless of the rendering size. All fields are optional so a
    client that only wants "add this item, no specific position" can send just
    {item_id}.
    """

    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    pos_x: float | None = Field(default=None, ge=-0.5, le=1.5)
    pos_y: float | None = Field(default=None, ge=-0.5, le=1.5)
    scale: float = Field(default=1.0, ge=0.2, le=3.0)
    rotation: float = Field(default=0.0, ge=-360.0, le=360.0)
    z_index: int = Field(default=0, ge=0, le=999)


class StudioCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[UUID] = Field(min_length=1, max_length=20)
    # When present, `items_layout` takes precedence and carries the canvas positions.
    # `items` still travels as a plain UUID list for older clients / analytics.
    items_layout: Annotated[list[StudioItemLayout] | None, Field(min_length=1, max_length=20)] = (
        None
    )
    occasion: str = Field(max_length=50)
    name: Annotated[str | None, Field(max_length=100)] = None
    scheduled_for: date | None = None
    mark_worn: bool = False
    source_item_id: UUID | None = None
    visibility: OutfitVisibility | None = None

    @field_validator("occasion")
    @classmethod
    def validate_occasion(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in VALID_OCCASIONS:
            raise ValueError(
                f"Invalid occasion '{v}'. Must be one of: {', '.join(sorted(VALID_OCCASIONS))}"
            )
        return v


class WoreInsteadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[UUID] = Field(min_length=1, max_length=20)
    rating: Annotated[int | None, Field(ge=1, le=5)] = None
    comment: Annotated[str | None, Field(max_length=1000)] = None
    scheduled_for: date | None = None


class CloneToLookbookRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)


class WearTodayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scheduled_for: date | None = None


class PatchOutfitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str | None, Field(max_length=100)] = None
    items: Annotated[list[UUID] | None, Field(min_length=1, max_length=20)] = None
    # When present, `items_layout` takes precedence and carries the canvas positions.
    items_layout: Annotated[list[StudioItemLayout] | None, Field(min_length=1, max_length=20)] = (
        None
    )


def _to_service_layout(lo: "StudioItemLayout") -> ItemLayoutInput:
    return ItemLayoutInput(
        item_id=lo.item_id,
        pos_x=lo.pos_x,
        pos_y=lo.pos_y,
        scale=lo.scale,
        rotation=lo.rotation,
        z_index=lo.z_index,
    )


def _resolve_item_layouts(
    items: list[UUID] | None,
    items_layout: list[StudioItemLayout] | None,
) -> list[ItemLayoutInput] | None:
    """Normalize the (items, items_layout) pair into a single list of layouts.

    - If `items_layout` is provided, it wins and defines both the set and the
      spatial positions. `items` (if also sent) must match — otherwise raise 400
      so the frontend catches accidental drift between the two fields.
    - If only `items` is provided (older/simpler client), wrap each UUID in a
      layout with no coordinates so downstream code has one shape to handle.
    - If both are None, return None (caller decides what that means).
    """
    if items_layout is not None:
        if items is not None:
            layout_ids = [lo.item_id for lo in items_layout]
            if sorted(layout_ids) != sorted(items):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "error_code": "OUTFIT_ITEMS_MISMATCH",
                        "message": "items and items_layout reference different sets",
                    },
                )
        return [_to_service_layout(lo) for lo in items_layout]
    if items is not None:
        return [ItemLayoutInput(item_id=iid) for iid in items]
    return None


async def _run_learning_safely(db: AsyncSession, outfit_id: UUID, user_id: UUID) -> None:
    try:
        await LearningService(db).process_feedback(outfit_id, user_id)
    except Exception as e:
        logger.exception("learning process_feedback failed for outfit %s: %s", outfit_id, e)


@router.post("/studio", response_model=OutfitResponse, status_code=status.HTTP_201_CREATED)
async def create_studio_outfit(
    request: StudioCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    _check_studio_kill_switch()
    await rate_limit_by_user(
        str(current_user.id), "studio_create", max_requests=20, window_seconds=60
    )

    layouts = _resolve_item_layouts(request.items, request.items_layout)

    service = StudioService(db)
    try:
        outfit = await service.create_from_scratch(
            user=current_user,
            item_ids=request.items,
            occasion=request.occasion,
            name=request.name,
            scheduled_for=request.scheduled_for,
            mark_worn=request.mark_worn,
            source_item_id=request.source_item_id,
            layouts=layouts,
        )
    except ItemOwnershipError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "OUTFIT_ITEM_OWNERSHIP",
                "message": "One or more items do not belong to you",
            },
        ) from None

    if request.visibility is not None:
        apply_visibility(outfit, request.visibility)

    await db.commit()
    await _run_learning_safely(db, outfit.id, current_user.id)
    await clear_suggestions(current_user.id, outfit.occasion)

    full = await service.get_full_outfit(outfit.id)
    return outfit_to_response(full)


@router.post("/{outfit_id}/wore-instead", response_model=OutfitResponse)
async def create_wore_instead_outfit(
    outfit_id: UUID,
    request: WoreInsteadRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    _check_studio_kill_switch()
    await rate_limit_by_user(
        str(current_user.id), "wore_instead", max_requests=10, window_seconds=60
    )

    service = StudioService(db)
    try:
        replacement = await service.create_wore_instead(
            user=current_user,
            original_outfit_id=outfit_id,
            item_ids=request.items,
            rating=request.rating,
            comment=request.comment,
            scheduled_for=request.scheduled_for,
        )
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "OUTFIT_NOT_FOUND", "message": "Outfit not found"},
        ) from None
    except ItemOwnershipError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "OUTFIT_ITEM_OWNERSHIP",
                "message": "One or more items do not belong to you",
            },
        ) from None

    await db.commit()
    await _run_learning_safely(db, replacement.id, current_user.id)
    await clear_suggestions(current_user.id, replacement.occasion)

    full = await service.get_full_outfit(replacement.id)
    return outfit_to_response(full)


@router.post("/{outfit_id}/clone-to-lookbook", response_model=OutfitResponse)
async def clone_outfit_to_lookbook(
    outfit_id: UUID,
    request: CloneToLookbookRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    _check_studio_kill_switch()
    await rate_limit_by_user(
        str(current_user.id), "clone_to_lookbook", max_requests=20, window_seconds=60
    )

    service = StudioService(db)
    try:
        clone = await service.clone_to_lookbook(
            user=current_user,
            source_outfit_id=outfit_id,
            name=request.name,
        )
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "OUTFIT_NOT_FOUND", "message": "Outfit not found"},
        ) from None

    await db.commit()
    await _run_learning_safely(db, clone.id, current_user.id)

    full = await service.get_full_outfit(clone.id)
    return outfit_to_response(full)


@router.post("/{outfit_id}/wear-today", response_model=OutfitResponse)
async def wear_outfit_today(
    outfit_id: UUID,
    request: WearTodayRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    _check_studio_kill_switch()
    await rate_limit_by_user(str(current_user.id), "wear_today", max_requests=10, window_seconds=60)

    service = StudioService(db)
    try:
        wear = await service.wear_today(
            user=current_user,
            template_id=outfit_id,
            scheduled_for=request.scheduled_for,
        )
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "OUTFIT_NOT_FOUND", "message": "Outfit not found"},
        ) from None
    except OutfitNotTemplateError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "OUTFIT_NOT_TEMPLATE",
                "message": "wear-today requires a lookbook template",
            },
        ) from None

    await db.commit()
    await _run_learning_safely(db, wear.id, current_user.id)
    await clear_suggestions(current_user.id, wear.occasion)

    full = await service.get_full_outfit(wear.id)
    return outfit_to_response(full)


@router.patch("/{outfit_id}", response_model=OutfitResponse)
async def patch_outfit_endpoint(
    outfit_id: UUID,
    request: PatchOutfitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    _check_studio_kill_switch()
    await rate_limit_by_user(
        str(current_user.id), "patch_outfit", max_requests=30, window_seconds=60
    )

    if request.name is None and request.items is None and request.items_layout is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "PATCH_EMPTY", "message": "No fields provided"},
        )

    layouts = (
        _resolve_item_layouts(request.items, request.items_layout)
        if (request.items is not None or request.items_layout is not None)
        else None
    )

    service = StudioService(db)
    try:
        updated = await service.patch_outfit(
            user=current_user,
            outfit_id=outfit_id,
            name=request.name,
            items=request.items,
            layouts=layouts,
        )
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "OUTFIT_NOT_FOUND", "message": "Outfit not found"},
        ) from None
    except ItemOwnershipError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "OUTFIT_ITEM_OWNERSHIP",
                "message": "One or more items do not belong to you",
            },
        ) from None
    except OutfitWornImmutableError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "OUTFIT_WORN_IMMUTABLE",
                "message": "Cannot modify items on a worn outfit. Create a new lookbook entry instead.",
            },
        ) from None

    await db.commit()

    full = await service.get_full_outfit(updated.id)
    return outfit_to_response(full)


@router.delete("/{outfit_id}/family-rating", status_code=status.HTTP_204_NO_CONTENT)
async def delete_family_rating(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    result = await db.execute(
        select(FamilyOutfitRating).where(
            and_(
                FamilyOutfitRating.outfit_id == outfit_id,
                FamilyOutfitRating.user_id == current_user.id,
            )
        )
    )
    rating = result.scalar_one_or_none()

    if not rating:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rating not found",
        )

    await db.delete(rating)
    await db.flush()


# -- Social: visibility and "outfit del día" -------------------------------------


class VisibilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visibility: OutfitVisibility


async def _get_own_outfit(db: AsyncSession, outfit_id: UUID, user: User) -> Outfit:
    outfit = (
        await db.execute(select(Outfit).where(Outfit.id == outfit_id, Outfit.user_id == user.id))
    ).scalar_one_or_none()
    if outfit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Outfit not found", "error_code": "OUTFIT_NOT_FOUND"},
        )
    return outfit


@router.patch("/{outfit_id}/visibility", response_model=OutfitResponse)
async def set_outfit_visibility(
    outfit_id: UUID,
    request: VisibilityRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    """Owner only: private (default) | friends | public."""
    outfit = await _get_own_outfit(db, outfit_id, current_user)
    apply_visibility(outfit, request.visibility)
    await db.commit()
    full = await StudioService(db).get_full_outfit(outfit.id)
    return outfit_to_response(full)


@router.post("/{outfit_id}/share", response_model=OutfitResponse)
async def share_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    """Share with friends ("Compartir con tus amigos"): private becomes friends-only (public stays public).

    Several outfits can be shared on the same day; the feed groups them per day.
    """
    await rate_limit_by_user(current_user.id, "share_outfit", max_requests=30, window_seconds=60)
    outfit = await _get_own_outfit(db, outfit_id, current_user)
    share_with_friends(outfit)
    await db.commit()
    full = await StudioService(db).get_full_outfit(outfit.id)
    return outfit_to_response(full)


@router.delete("/{outfit_id}/share", response_model=OutfitResponse)
async def unshare_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    """Stop sharing: the outfit goes back to private."""
    outfit = await _get_own_outfit(db, outfit_id, current_user)
    apply_visibility(outfit, OutfitVisibility.private)
    await db.commit()
    full = await StudioService(db).get_full_outfit(outfit.id)
    return outfit_to_response(full)
