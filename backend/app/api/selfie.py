"""Selfie -> "qué llevas puesto".

``POST /selfie/analyze`` takes one full-body photo, asks the vision model which
garments are visible and matches each of them against the user's wardrobe. The
photo is processed **in memory only**: it is never written to disk, never stored
in the database and nothing about the person is kept — only the garment list
travels back to the client. There is therefore nothing to delete afterwards.

``POST /selfie/items`` adds one detected garment that matched nothing to the
wardrobe, prefilled with the detected type/colour/pattern and a plain colour
placeholder photo (no crop of the selfie, so no pixel of the person becomes an
item image; the user can replace it later with ``PUT /items/{id}/image``).

Logging the result as worn today or saving it as a look reuses the existing
studio endpoints (``POST /outfits/studio`` with ``mark_worn``), so this module
adds no second way to write outfits.
"""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import ClothingItem, ItemStatus
from app.models.user import User
from app.schemas.item import ItemCreate, ItemResponse, ItemTags, ItemUpdate
from app.services.ai_access import AIAccessError, ai_error_detail, require_ai_client
from app.services.ai_service import (
    VALID_COLORS,
    VALID_MATERIALS,
    VALID_PATTERNS,
    VALID_TYPES,
    AIDisabledError,
    AIResponseError,
)
from app.services.image_service import ImageService
from app.services.item_service import ItemService
from app.services.selfie_outfit import (
    DetectedGarment,
    SelfieImageError,
    build_color_swatch,
    match_garments,
    parse_detections,
    sanitize_selfie,
)
from app.utils.auth import get_current_user
from app.utils.prompts import load_prompt
from app.utils.rate_limit import rate_limit_by_user
from app.utils.signed_urls import sign_image_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/selfie", tags=["Selfie"])

Db = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

SELFIE_PROMPT = load_prompt("selfie_outfit")

# One vision call per analyse: keep it cheap and hard to abuse.
ANALYZE_BURST = (3, 60)
ANALYZE_HOURLY = (15, 3600)
ITEM_CREATE_LIMIT = (40, 3600)

# The wardrobe is loaded whole for the matcher; a cap keeps one request bounded.
MAX_WARDROBE_ITEMS = 500


# --- Schemas ----------------------------------------------------------------------


class SelfieItemSummary(BaseModel):
    """Just enough of a wardrobe item to draw its card in the result."""

    id: UUID
    name: str | None = None
    type: str
    subtype: str | None = None
    primary_color: str | None = None
    colors: list[str] = Field(default_factory=list)
    pattern: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None

    @classmethod
    def from_item(cls, item: ClothingItem) -> "SelfieItemSummary":
        return cls(
            id=item.id,
            name=item.name,
            type=item.type,
            subtype=item.subtype,
            primary_color=item.primary_color,
            colors=list(item.colors or []),
            pattern=item.pattern,
            thumbnail_url=sign_image_url(item.thumbnail_path) if item.thumbnail_path else None,
            image_url=sign_image_url(item.image_path) if item.image_path else None,
        )


class SelfieGarmentResponse(BaseModel):
    """One garment read off the photo, with the wardrobe item it looks like."""

    index: int
    type: str
    subtype: str | None = None
    primary_color: str | None = None
    colors: list[str] = Field(default_factory=list)
    pattern: str | None = None
    material: str | None = None
    match: SelfieItemSummary | None = None
    alternatives: list[SelfieItemSummary] = Field(default_factory=list)


class SelfieAnalyzeResponse(BaseModel):
    garments: list[SelfieGarmentResponse] = Field(default_factory=list)
    matched_count: int = 0
    # Always false: the selfie is processed in memory and never kept.
    photo_stored: bool = False


class SelfieItemCreate(BaseModel):
    """A detected garment the user wants in the wardrobe."""

    type: str = Field(max_length=50)
    subtype: str | None = Field(default=None, max_length=50)
    primary_color: str | None = Field(default=None, max_length=50)
    colors: list[str] = Field(default_factory=list, max_length=3)
    pattern: str | None = Field(default=None, max_length=50)
    material: str | None = Field(default=None, max_length=50)
    name: str | None = Field(default=None, max_length=100)


def _ai_http_error(e: AIDisabledError) -> HTTPException:
    if isinstance(e, AIAccessError):
        code, detail = ai_error_detail(e)
        return HTTPException(status_code=code, detail=detail)
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"code": "ai_disabled", "message": "AI is disabled on this server."},
    )


async def _load_wardrobe(db: AsyncSession, user_id: UUID) -> list[ClothingItem]:
    result = await db.execute(
        select(ClothingItem)
        .where(
            ClothingItem.user_id == user_id,
            ClothingItem.is_archived.is_(False),
            ClothingItem.status == ItemStatus.ready,
        )
        .order_by(ClothingItem.created_at.desc())
        .limit(MAX_WARDROBE_ITEMS)
    )
    return list(result.scalars().all())


# --- Endpoints ----------------------------------------------------------------------


@router.post("/analyze", response_model=SelfieAnalyzeResponse)
async def analyze_selfie(
    db: Db,
    current_user: CurrentUser,
    image: UploadFile = File(..., description="Full-body photo of the outfit being worn"),
) -> SelfieAnalyzeResponse:
    await rate_limit_by_user(current_user.id, "selfie_analyze_burst", *ANALYZE_BURST)
    await rate_limit_by_user(current_user.id, "selfie_analyze", *ANALYZE_HOURLY)

    try:
        ai = await require_ai_client(db, current_user, "vision")
    except AIDisabledError as e:
        raise _ai_http_error(e) from None

    content = await image.read()
    try:
        # In memory from here on: sanitized (EXIF/GPS dropped) and never stored.
        image_base64 = sanitize_selfie(content)
    except SelfieImageError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "selfie_invalid_image", "message": str(e)},
        ) from None
    finally:
        del content

    try:
        raw = await ai.analyze_vision_json(image_base64, SELFIE_PROMPT, task_name="selfie")
    except AIResponseError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "selfie_ai_failed", "message": str(e)},
        ) from None
    except Exception as e:
        logger.warning("Selfie analysis failed: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "selfie_ai_failed", "message": "The photo could not be analysed."},
        ) from None
    finally:
        del image_base64

    detections = parse_detections(raw)
    if not detections:
        return SelfieAnalyzeResponse(garments=[], matched_count=0)

    wardrobe = await _load_wardrobe(db, current_user.id)
    matches = match_garments(detections, wardrobe)

    garments = [
        SelfieGarmentResponse(
            index=idx,
            type=m.detected.type,
            subtype=m.detected.subtype,
            primary_color=m.detected.primary_color,
            colors=m.detected.colors,
            pattern=m.detected.pattern,
            material=m.detected.material,
            match=SelfieItemSummary.from_item(m.match) if m.match is not None else None,
            alternatives=[SelfieItemSummary.from_item(i) for i in m.alternatives],
        )
        for idx, m in enumerate(matches)
    ]
    return SelfieAnalyzeResponse(
        garments=garments,
        matched_count=sum(1 for g in garments if g.match is not None),
    )


@router.post("/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item_from_detection(
    payload: SelfieItemCreate,
    db: Db,
    current_user: CurrentUser,
) -> ItemResponse:
    """Add a detected garment to the wardrobe with a placeholder photo.

    The placeholder is a flat tile in the detected colour: the selfie is never
    cropped into an item image. The user can replace the photo later.
    """
    await rate_limit_by_user(current_user.id, "selfie_item_create", *ITEM_CREATE_LIMIT)

    detected = DetectedGarment(
        type=payload.type.strip().lower(),
        subtype=(payload.subtype or "").strip().lower() or None,
        primary_color=(payload.primary_color or "").strip().lower() or None,
        colors=[c.strip().lower() for c in payload.colors if c and c.strip()],
        pattern=(payload.pattern or "").strip().lower() or None,
        material=(payload.material or "").strip().lower() or None,
    )
    if detected.type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "selfie_invalid_type", "message": "Unknown garment type"},
        )
    if detected.primary_color and detected.primary_color not in VALID_COLORS:
        detected.primary_color = None
    detected.colors = [c for c in detected.colors if c in VALID_COLORS]
    if detected.primary_color and detected.primary_color not in detected.colors:
        detected.colors.insert(0, detected.primary_color)
    if detected.pattern not in VALID_PATTERNS:
        detected.pattern = None
    if detected.material not in VALID_MATERIALS:
        detected.material = None

    image_service = ImageService()
    item_service = ItemService(db)
    try:
        image_paths = await image_service.process_and_store(
            user_id=current_user.id,
            image_data=build_color_swatch(detected.primary_color),
            original_filename="placeholder.jpg",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None

    item = await item_service.create(
        user_id=current_user.id,
        item_data=ItemCreate(
            type=detected.type,
            subtype=detected.subtype,
            name=(payload.name or "").strip() or None,
            colors=detected.colors,
            primary_color=detected.primary_color,
        ),
        image_paths=image_paths,
    )
    # The placeholder is not a photo of the garment, so it never goes to AI
    # tagging; the write-back below fills the columns from the detection.
    item = await item_service.update(
        item,
        ItemUpdate(
            tags=ItemTags(
                colors=detected.colors,
                primary_color=detected.primary_color,
                pattern=detected.pattern,
                material=detected.material,
            )
        ),
    )
    item = await item_service.mark_pending(item, set_ready=True)
    await db.commit()
    return ItemResponse.model_validate(item)
