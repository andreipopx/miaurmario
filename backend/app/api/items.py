import asyncio
import base64
import json
import logging
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID
from zoneinfo import ZoneInfo

from arq import create_pool
from arq.jobs import Job
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import get_settings
from app.database import get_db
from app.models.item import (
    ClothingItem,
    ImageView,
    ItemImage,
    ItemStatus,
    TaggedBy,
    TaggingStatus,
    normalize_image_view,
)
from app.models.user import User
from app.schemas.item import (
    ArchiveRequest,
    BulkAnalyzeRequest,
    BulkAnalyzeResponse,
    BulkDeleteRequest,
    BulkDeleteResponse,
    BulkTagRequest,
    BulkTagResponse,
    BulkUploadResponse,
    BulkUploadResult,
    CareInfo,
    CareLabelResponse,
    ItemCreate,
    ItemFilter,
    ItemImageResponse,
    ItemListResponse,
    ItemResponse,
    ItemUpdate,
    ItemUsageResponse,
    LinkPreviewImage,
    LinkPreviewRequest,
    LinkPreviewResponse,
    LogWashRequest,
    LogWearRequest,
    MergeItemRequest,
    MergeItemResponse,
    RemoveBackgroundRequest,
    ReorderImagesRequest,
    SetImageViewRequest,
    WardrobeStats,
    WashHistoryResponse,
)
from app.services import link_import
from app.services.ai_access import ai_error_detail, get_ai_access, require_ai_client
from app.services.ai_service import AIDisabledError
from app.services.care_label import parse_care_label
from app.services.image_service import CropBox, ImageService
from app.services.item_service import ItemService
from app.services.recommendation_service import MIN_CANDIDATES_FOR_OUTFIT
from app.services.wardrobe_usage import item_usage
from app.utils.auth import get_current_user
from app.utils.care import care_hints, dominant_material
from app.utils.error_codes import error_detail
from app.utils.rate_limit import rate_limit_by_user
from app.utils.timezone import get_user_today
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/items", tags=["Items"])

TAG_WRITEBACK_FIELDS = {
    "type",
    "subtype",
    "colors",
    "primary_color",
    # Sampling the shade off the photo is the user naming the colour, so it counts
    # as a manual tag on its own even when the family does not change.
    "primary_color_hex",
    "style",
    "formality",
    "season",
    "tags",
}
_EMPTY_TAG_VALUES = (None, "", [], {})

# Filling an empty wardrobe means many photos in a short burst, so the budgets are
# counted in photos rather than in requests: /items/bulk charges one unit per
# photo whether the client sends them one at a time or all at once. Generous
# enough that a full batch never trips them — a 30-photo batch plus a retry pass
# fits in the minute — while the hour still caps a runaway client.
BULK_UPLOAD_BURST = (60, 60)
BULK_UPLOAD_HOURLY = (300, 3600)
BULK_TAG_LIMIT = (60, 60)

# Not a gate, a goal: two garments is all the stylist strictly needs, but below
# roughly a dozen it keeps proposing the same look. The nudge says both numbers.
VARIETY_TARGET_ITEMS = 12


async def _can_auto_tag(db: AsyncSession, user: User) -> bool:
    """Whether uploads should be queued for AI tagging for this user.

    Users without AI (free plan, exhausted cap, no vision model) still upload
    normally; the item is saved untagged and tagged manually.
    """
    if not settings.effective_ai_vision_enabled:
        return False
    access = await get_ai_access(db, user, check_network=False)
    return access.supports("vision")


def _parse_id_list(raw: str | None) -> list[UUID] | None:
    """Comma-separated ids from the query string; a malformed one is a 400, not a 500."""
    if not raw or not raw.strip():
        return None
    try:
        return [UUID(part.strip()) for part in raw.split(",") if part.strip()] or None
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_ids", "message": "ids must be a comma-separated id list"},
        ) from None


def _has_tag_content(field: str, value: Any) -> bool:
    if field == "tags" and isinstance(value, dict):
        return any(v not in _EMPTY_TAG_VALUES for v in value.values())
    return value not in _EMPTY_TAG_VALUES


def _clean_source_url(raw: str | None) -> str | None:
    """Normalize the shop link before it is stored (and later rendered as href)."""
    if not raw or not raw.strip():
        return None
    try:
        normalized, _host, _port = link_import.normalize_link_url(raw)
    except link_import.LinkImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.reason, "message": exc.message},
        ) from None
    return normalized


def _adopt_paths(item: ClothingItem, paths: dict[str, str]) -> list[str | None]:
    """Point the item at re-rendered files; returns the paths it no longer uses.

    Background removal now writes WebP (it has to, to keep the transparency), so a
    re-render changes the filenames and not only their contents. The item has to
    follow, and the files it left behind are deleted once the new paths are safely
    committed.
    """
    previous: list[str | None] = [item.image_path, item.medium_path, item.thumbnail_path]
    item.image_path = paths["image_path"]
    item.medium_path = paths.get("medium_path")
    item.thumbnail_path = paths.get("thumbnail_path")
    return previous


#: A garment's own photo plus this many more. Four is what the item detail's
#: thumbnail strip can lay out at 320 px without scrolling into nothing.
MAX_EXTRA_IMAGES = 4


def _later(a, b):
    """The later of two dates, either of which may be missing."""
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b)


def _default_extra_view(existing_extras: int, asked: str | None) -> str:
    """Which side an extra photo shows, when the client did not say.

    The second photo of a garment is its back — that is what people take a second
    photo *for* — so the first extra photo is labelled ``back`` and everything
    after it ``detail``. It is only a default: the item detail lets the owner
    relabel any photo, and a client that knows better may say so outright.
    """
    if asked in {v.value for v in ImageView}:
        return str(asked)
    return ImageView.back.value if existing_extras == 0 else ImageView.detail.value


#: Columns the quick pass and the detail editor write, mirrored into ``tags`` so
#: the two never disagree.
_MIRRORED_TAG_COLUMNS = ("colors", "primary_color", "style", "season", "formality")


def _mirror_tags(item: ClothingItem) -> None:
    tags = dict(item.tags or {})
    for column in _MIRRORED_TAG_COLUMNS:
        tags[column] = getattr(item, column)
    item.tags = tags
    flag_modified(item, "tags")


def _parse_crop(
    x: int | None, y: int | None, width: int | None, height: int | None
) -> CropBox | None:
    """The crop the client reported, or None when it could not measure the photo.

    The cropper needs the browser to decode the image to report a box at all, which
    it cannot do for HEIC outside Safari. Rather than guess, it sends nothing and the
    whole photo is kept — the same fallback the avatar cropper uses.
    """
    if x is None or y is None or width is None or height is None:
        return None
    if width <= 0 or height <= 0:
        return None
    return CropBox(x=max(0, x), y=max(0, y), width=width, height=height)


def _parse_care_form(raw: str | None) -> CareInfo | None:
    """The multipart form carries care data as a JSON object."""
    if not raw or not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_care", "message": "Care data is not valid JSON"},
        ) from None
    try:
        care = CareInfo.model_validate(payload)
    except ValidationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_care", "message": "Care data is not valid"},
        ) from None
    return None if care.is_empty() else care


@router.get("", response_model=ItemListResponse)
async def list_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    ids: str | None = Query(None, description="Comma-separated item ids to restrict the list to"),
    type: str | None = None,
    subtype: str | None = None,
    colors: str | None = None,
    status: str | None = None,
    tagging_status: str | None = None,
    favorite: bool | None = None,
    needs_wash: bool | None = None,
    is_archived: bool = False,
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: str = "desc",
) -> ItemListResponse:
    color_list = colors.split(",") if colors else None

    filters = ItemFilter(
        ids=_parse_id_list(ids),
        type=type,
        subtype=subtype,
        colors=color_list,
        status=status,
        tagging_status=tagging_status,
        favorite=favorite,
        needs_wash=needs_wash,
        is_archived=is_archived,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    item_service = ItemService(db)
    items, total = await item_service.get_list(
        user_id=current_user.id,
        filters=filters,
        page=page,
        page_size=page_size,
    )

    return ItemListResponse(
        items=[ItemResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(page * page_size) < total,
    )


@router.post("/link-preview", response_model=LinkPreviewResponse)
async def preview_item_link(
    payload: LinkPreviewRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> LinkPreviewResponse:
    """Read a pasted shop link and hand the fields to the review screen.

    Nothing is saved here: the user always sees what we read before the garment
    exists. A link we cannot read still comes back 200 with ``extracted: false``
    so the add form can open with the link filled in and the rest typed by hand.
    """
    if not settings.link_import_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "link_import_disabled", "message": "Link import is turned off"},
        )
    await rate_limit_by_user(current_user.id, "item_link_preview", 20, 300)

    try:
        result = await link_import.import_link(payload.url)
    except link_import.LinkImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.reason, "message": exc.message},
        ) from None

    extraction = result.extraction
    image: LinkPreviewImage | None = None
    if result.image and result.image_content_type:
        encoded = base64.b64encode(result.image).decode("ascii")
        image = LinkPreviewImage(
            data_url=f"data:{result.image_content_type};base64,{encoded}",
            content_type=result.image_content_type,
            size_bytes=len(result.image),
        )

    return LinkPreviewResponse(
        source_url=extraction.source_url,
        extracted=result.extracted,
        reason=result.reason,
        name=extraction.name,
        brand=extraction.brand,
        price=extraction.price,
        currency=extraction.currency,
        primary_color=extraction.primary_color,
        description=extraction.description,
        site_name=extraction.site_name,
        image=image,
    )


@router.post("/care-label", response_model=CareLabelResponse)
async def read_care_label(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
) -> CareLabelResponse:
    """Read the washing label in a photo into structured care data.

    Needs vision AI. Wardrobes without it get the usual ``ai_*`` code and the
    form falls back to typing the care information in by hand.
    """
    await rate_limit_by_user(current_user.id, "item_care_label", 20, 300)

    image_service = ImageService()
    content = await image.read()
    if not image_service.validate_image(content, image.content_type or "application/octet-stream"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    try:
        ai_service = await require_ai_client(db, current_user, "vision")
    except AIDisabledError as e:
        code, detail = ai_error_detail(e)
        raise HTTPException(status_code=code, detail=detail) from None

    suffix = Path(image.filename or "label.jpg").suffix or ".jpg"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)  # noqa: SIM115
    try:
        tmp.write(content)
        tmp.close()
        raw = await ai_service.analyze_care_label(tmp.name)
    except AIDisabledError as e:
        code, detail = ai_error_detail(e)
        raise HTTPException(status_code=code, detail=detail) from None
    except Exception as e:
        logger.warning(f"Care label read failed: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "care_label_failed", "message": "We could not read that label"},
        ) from None
    finally:
        Path(tmp.name).unlink(missing_ok=True)

    care = parse_care_label(raw or "")
    payload = care.model_dump()
    return CareLabelResponse(
        care=care,
        hints=care_hints(payload),
        suggested_material=dominant_material(payload.get("composition") or []),
        read=not care.is_empty(),
    )


@router.post("", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
    type: str | None = Form(None),  # Optional - AI will detect if not provided
    subtype: str | None = Form(None),
    name: str | None = Form(None),
    brand: str | None = Form(None),
    notes: str | None = Form(None),
    colors: str | None = Form(None),
    primary_color: str | None = Form(None),
    primary_color_hex: str | None = Form(
        None, description="The shade sampled off the photo, as #rrggbb. Display only."
    ),
    favorite: bool = Form(False),
    skip_ai: bool = Form(False),
    source_url: str | None = Form(None),
    care: str | None = Form(None, description="CareInfo as a JSON object"),
    rotate: int = Form(0, description="Quarter turns clockwise the user applied in the preview"),
    crop_x: int | None = Form(None, description="Crop, in pixels of the upright, rotated image"),
    crop_y: int | None = Form(None),
    crop_w: int | None = Form(None),
    crop_h: int | None = Form(None),
    erase_mask: UploadFile | None = File(
        None,
        description="'Borra lo que sobra' from the add form: an RGBA PNG in the "
        "coordinates of the upright, rotated photo. Red erases, green restores.",
    ),
) -> ItemResponse:
    # Validate and process image
    image_service = ImageService()
    item_service = ItemService(db)

    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    # How the user framed the photo in the preview: the same turns and crop are
    # applied before hashing and before storing, so the duplicate check and the
    # three stored sizes all see the garment the user actually saved.
    crop = _parse_crop(crop_x, crop_y, crop_w, crop_h)

    # Compute hash and check for duplicates BEFORE storing
    try:
        image_hash = image_service.compute_phash(
            content, image.filename or "upload.jpg", rotate=rotate, crop=crop
        )
        existing = await item_service.find_duplicate_by_hash(current_user.id, image_hash)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Duplicate image detected. This item already exists in your wardrobe (ID: {existing.id})",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to compute image hash: {e}")
        # Continue without duplicate check if hash computation fails

    brush = await _read_brush_mask(erase_mask) if erase_mask is not None else None

    # Process and store image
    try:
        image_paths = await image_service.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename=image.filename or "upload.jpg",
            rotate=rotate,
            crop=crop,
            erase_mask=brush,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None

    # Parse colors from comma-separated string
    color_list = colors.split(",") if colors else None

    # Create item - use "unknown" if type not provided (AI will detect)
    item_data = ItemCreate(
        type=type or "unknown",
        subtype=subtype,
        name=name,
        brand=brand,
        notes=notes,
        colors=color_list,
        primary_color=primary_color,
        primary_color_hex=primary_color_hex,
        favorite=favorite,
        source_url=_clean_source_url(source_url),
        care=_parse_care_form(care),
    )

    item = await item_service.create(
        user_id=current_user.id,
        item_data=item_data,
        image_paths=image_paths,
    )

    if brush:
        # Nothing removes the background on this path, so the strokes are applied to
        # the photo as it stands: the garment becomes a cut-out with exactly the bits
        # the user wiped away missing. A failure here must not cost them the garment.
        try:
            brushed = await asyncio.to_thread(image_service.apply_pending_brush, item.image_path)
            if brushed:
                stale = _adopt_paths(item, brushed)
                item.original_image_path = brushed["original_backup_path"]
                await db.commit()
                await db.refresh(
                    item,
                    attribute_names=[
                        "image_path",
                        "medium_path",
                        "thumbnail_path",
                        "original_image_path",
                        "updated_at",
                    ],
                )
                image_service.delete_replaced(
                    stale, [item.image_path, item.medium_path, item.thumbnail_path]
                )
        except Exception as e:
            logger.warning(f"Could not apply the erase mask for item {item.id}: {e}")

    do_auto_tag = not skip_ai and await _can_auto_tag(db, current_user)

    if do_auto_tag:
        try:
            redis = await create_pool(get_redis_settings())
            try:
                full_image_path = f"{settings.storage_path}/{image_paths['image_path']}"
                job = await redis.enqueue_job(
                    "tag_item_image",
                    str(item.id),
                    full_image_path,
                    _queue_name="arq:tagging",
                )
                item.ai_job_id = job.job_id
                await db.commit()
                await db.refresh(item, attribute_names=["updated_at"])
                logger.info(f"Queued AI tagging job for item {item.id}")
            finally:
                await redis.aclose()
        except Exception as e:
            logger.error(f"Failed to queue AI tagging job: {e}")
    else:
        item = await item_service.mark_pending(item, set_ready=True)

    return ItemResponse.model_validate(item)


async def _charge_bulk_upload(user_id: UUID, photos: int) -> None:
    """Both upload budgets, charged in photos rather than in requests."""
    await rate_limit_by_user(user_id, "item_bulk_upload_burst", *BULK_UPLOAD_BURST, cost=photos)
    await rate_limit_by_user(user_id, "item_bulk_upload", *BULK_UPLOAD_HOURLY, cost=photos)


async def _queue_tagging(db: AsyncSession, item: ClothingItem, image_path: str) -> bool:
    """Hand the item to the tagging worker. Returns whether the job was accepted.

    Tagging is never done in the request: a batch of thirty photos would otherwise
    hold the connection open for minutes.
    """
    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis to queue tagging: {e}")
        return False
    try:
        job = await redis.enqueue_job(
            "tag_item_image",
            str(item.id),
            f"{settings.storage_path}/{image_path}",
            _queue_name="arq:tagging",
        )
        item.ai_job_id = job.job_id if job is not None else None
        await db.commit()
        await db.refresh(item, attribute_names=["updated_at"])
        logger.info(f"Queued AI tagging for item {item.id}")
        return True
    except Exception as e:
        logger.error(f"Failed to queue AI tagging for {item.id}: {e}")
        return False
    finally:
        await redis.aclose()


@router.post("/bulk/tag", response_model=BulkTagResponse)
async def bulk_tag_items(
    request: BulkTagRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BulkTagResponse:
    """The quick review pass: type and colour for a handful of items at once.

    Used both by the manual stepper (no AI: the items arrive untagged) and by the
    post-batch review (AI guessed: the user only sends the rows they touched or
    explicitly confirmed). Either way the item ends up user-tagged.
    """
    await rate_limit_by_user(current_user.id, "item_bulk_tag", *BULK_TAG_LIMIT)

    item_service = ItemService(db)
    now = datetime.now(UTC)
    updated = 0
    failed = 0
    errors: list[str] = []

    for entry in request.items:
        item = await item_service.get_by_id(entry.item_id, current_user.id)
        if item is None:
            errors.append(f"Item {entry.item_id} not found or not owned by user")
            failed += 1
            continue

        if entry.type:
            item.type = entry.type
        if entry.subtype is not None:
            # "" clears the column: the tagger's subtype guess ("wrap" for a halter
            # top) is what the pass is most often here to remove, and a row that
            # cannot say "none of these" would leave it on the garment forever.
            item.subtype = entry.subtype or None
        if entry.primary_color:
            item.primary_color = entry.primary_color
            if not item.colors:
                item.colors = [entry.primary_color]
            # A row that names a family sets the shade to whatever came with it,
            # including nothing: picking "marrón" off the swatches means the shade
            # the tagger sampled no longer describes the garment.
            item.primary_color_hex = entry.primary_color_hex
        elif entry.primary_color_hex:
            # Eyedropper on a garment whose family is already right: keep the family,
            # take the shade.
            item.primary_color_hex = entry.primary_color_hex
        if entry.style is not None:
            item.style = entry.style
        if entry.formality:
            item.formality = entry.formality
        if entry.season is not None:
            item.season = entry.season
        # The detail view reads `tags`, the scorer reads the columns: keep both in
        # step or a garment the user just tagged reads as untagged on its own page.
        _mirror_tags(item)

        item.tagging_status = TaggingStatus.tagged
        item.tagged_by = TaggedBy.manual
        item.tagged_at = now
        # An item whose AI job died is still a perfectly good garment once the user
        # has named it, so the manual pass also rescues it out of the error state.
        if item.status == ItemStatus.error:
            item.status = ItemStatus.ready
        updated += 1

    await db.commit()
    return BulkTagResponse(updated=updated, failed=failed, errors=errors)


@router.post("/bulk", response_model=BulkUploadResponse, status_code=status.HTTP_201_CREATED)
async def bulk_create_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    images: list[UploadFile] = File(..., description="Image files to upload"),
    skip_ai: bool = Form(False),
    remove_background: bool = Form(True),
) -> BulkUploadResponse:
    """Create items from a batch of photos.

    Still takes a list, so an existing caller that hands over twenty at once keeps
    working. The bulk-upload UI sends one photo per call instead, because that is
    the only way each row of its queue can have its own progress, its own error and
    its own retry — and because one bad photo then costs one photo.

    Every photo goes through the same path the single add form uses: ItemService
    creates the item, the background comes off in the request (rembg is warm in
    this process), and tagging goes to the worker. None of those three is allowed
    to cost the garment: no AI, no rembg and no Redis are ordinary configurations,
    and in all of them the item still lands, ready and untagged.
    """
    if len(images) > settings.max_bulk_upload_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "too_many_images",
                "message": f"Maximum {settings.max_bulk_upload_count} images per bulk upload",
            },
        )

    if len(images) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "no_images", "message": "At least one image is required"},
        )

    # Charged per photo rather than per request, so the budget means the same
    # thing whether the client sends one photo or twenty.
    await _charge_bulk_upload(current_user.id, len(images))

    image_service = ImageService()
    item_service = ItemService(db)
    results: list[BulkUploadResult] = []
    successful = 0
    failed = 0
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    do_auto_tag = not skip_ai and await _can_auto_tag(db, current_user)

    for upload_file in images:
        filename = upload_file.filename or "unknown.jpg"

        try:
            content = await upload_file.read()
            content_type = upload_file.content_type or "application/octet-stream"

            # Size and format are separate refusals: "that photo is too big" and
            # "that is not a photo" are different problems with different fixes,
            # and a queue row that says which one is a row the user can act on.
            if len(content) > max_bytes:
                results.append(
                    BulkUploadResult(
                        filename=filename,
                        success=False,
                        state="error",
                        error_code="too_big",
                        error=f"Image is larger than {settings.max_upload_size_mb} MB",
                    )
                )
                failed += 1
                continue

            if not image_service.validate_image(content, content_type):
                results.append(
                    BulkUploadResult(
                        filename=filename,
                        success=False,
                        state="error",
                        error_code="invalid_format",
                        error="Invalid image format. Supported: JPEG, PNG, WebP, HEIC",
                    )
                )
                failed += 1
                continue

            # A photo the wardrobe already has is not a failure the user caused, so
            # it comes back pointing at the garment that is already there.
            try:
                image_hash = image_service.compute_phash(content, filename)
                existing = await item_service.find_duplicate_by_hash(current_user.id, image_hash)
            except Exception as e:
                logger.warning(f"Failed to check duplicate for {filename}: {e}")
                existing = None
            if existing is not None:
                # Re-read it: the duplicate lookup does not eager-load
                # additional_images, and serialising it lazily would explode
                # outside the greenlet.
                loaded = await item_service.get_by_id(existing.id, current_user.id)
                results.append(
                    BulkUploadResult(
                        filename=filename,
                        success=False,
                        state="duplicate",
                        error_code="duplicate",
                        error="Duplicate image - already exists in wardrobe",
                        item=ItemResponse.model_validate(loaded or existing),
                        tagging="skipped",
                    )
                )
                failed += 1
                continue

            image_paths = await image_service.process_and_store(
                user_id=current_user.id,
                image_data=content,
                original_filename=filename,
            )

            item = await item_service.create(
                user_id=current_user.id,
                item_data=ItemCreate(type="unknown"),
                image_paths=image_paths,
            )

            background_removed = False
            if remove_background:
                try:
                    removal = await asyncio.to_thread(
                        image_service.remove_background, image_paths["image_path"]
                    )
                    stale = _adopt_paths(item, removal)
                    item.original_image_path = removal["original_backup_path"]
                    await db.commit()
                    await db.refresh(
                        item,
                        attribute_names=[
                            "image_path",
                            "medium_path",
                            "thumbnail_path",
                            "original_image_path",
                            "updated_at",
                        ],
                    )
                    image_service.delete_replaced(
                        stale, [item.image_path, item.medium_path, item.thumbnail_path]
                    )
                    background_removed = True
                except Exception as e:
                    # No provider installed, or a photo rembg chokes on: the item
                    # keeps its original image and the batch carries on. Losing the
                    # cut-out is not worth losing the garment.
                    logger.warning(f"Background removal skipped for item {item.id}: {e}")

            queued = False
            if do_auto_tag:
                # `item.image_path`, not the upload's: the cut-out was written under
                # a new name and the file the tagger was told about is already gone.
                queued = await _queue_tagging(db, item, item.image_path)
            if not queued:
                # No AI, or the queue is down: the item is usable right away and
                # waits for the manual "tipo + color" pass instead of sitting in
                # "processing" for ever.
                item = await item_service.mark_pending(item, set_ready=True)

            results.append(
                BulkUploadResult(
                    filename=filename,
                    success=True,
                    state="created",
                    item=ItemResponse.model_validate(item),
                    tagging="queued" if queued else "skipped",
                    background_removed=background_removed,
                )
            )
            successful += 1

        except ValueError as e:
            results.append(
                BulkUploadResult(
                    filename=filename,
                    success=False,
                    state="error",
                    error_code="invalid_format",
                    error=str(e),
                )
            )
            failed += 1
        except Exception as e:
            logger.error(f"Error processing {filename}: {e}")
            results.append(
                BulkUploadResult(
                    filename=filename,
                    success=False,
                    state="error",
                    error_code="failed",
                    error="Failed to process image",
                )
            )
            failed += 1

    return BulkUploadResponse(
        total=len(images),
        successful=successful,
        failed=failed,
        results=results,
    )


@router.post("/bulk/delete", response_model=BulkDeleteResponse)
async def bulk_delete_items(
    request: BulkDeleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BulkDeleteResponse:
    item_service = ItemService(db)
    image_service = ImageService()
    deleted = 0
    failed = 0
    errors: list[str] = []

    # Get item IDs to delete
    if request.select_all:
        # Get all items matching filters, excluding specified ones
        item_ids = await item_service.get_ids_by_filter(
            user_id=current_user.id,
            type_filter=request.filters.type if request.filters else None,
            search=request.filters.search if request.filters else None,
            is_archived=request.filters.is_archived
            if request.filters and request.filters.is_archived is not None
            else False,
            excluded_ids=list(request.excluded_ids) if request.excluded_ids else None,
        )
        logger.info(f"Bulk delete select_all: {len(item_ids)} items to delete")
    else:
        item_ids = request.item_ids or []

    for item_id in item_ids:
        try:
            item = await item_service.get_by_id(item_id, current_user.id)
            if not item:
                errors.append(f"Item {item_id} not found or not owned by user")
                failed += 1
                continue

            image_service.delete_images(
                {
                    "image_path": item.image_path,
                    "medium_path": item.medium_path,
                    "thumbnail_path": item.thumbnail_path,
                    "original_backup_path": item.original_image_path,
                }
            )

            await item_service.delete(item)
            deleted += 1
        except Exception as e:
            logger.error(f"Failed to delete item {item_id}: {e}")
            errors.append(f"Failed to delete item {item_id}")
            failed += 1

    return BulkDeleteResponse(deleted=deleted, failed=failed, errors=errors)


@router.post("/bulk/analyze", response_model=BulkAnalyzeResponse)
async def bulk_analyze_items(
    request: BulkAnalyzeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> BulkAnalyzeResponse:
    item_service = ItemService(db)
    queued = 0
    failed = 0
    errors: list[str] = []

    # Get item IDs to analyze
    if request.select_all:
        item_ids = await item_service.get_ids_by_filter(
            user_id=current_user.id,
            type_filter=request.filters.type if request.filters else None,
            search=request.filters.search if request.filters else None,
            is_archived=request.filters.is_archived
            if request.filters and request.filters.is_archived is not None
            else False,
            excluded_ids=list(request.excluded_ids) if request.excluded_ids else None,
        )
        logger.info(f"Bulk analyze select_all: {len(item_ids)} items to analyze")
    else:
        item_ids = request.item_ids or []

    # Collect valid items first
    items_to_process = []
    for item_id in item_ids:
        item = await item_service.get_by_id(item_id, current_user.id)
        if not item:
            errors.append(f"Item {item_id} not found or not owned by user")
            failed += 1
            continue
        items_to_process.append(item)

    if not await _can_auto_tag(db, current_user):
        for item in items_to_process:
            item.status = ItemStatus.ready
            item.tagging_status = TaggingStatus.pending
            item.tagged_by = None
            item.tagged_at = None
        await db.commit()
        return BulkAnalyzeResponse(queued=0, failed=failed, errors=errors)

    for item in items_to_process:
        item.status = ItemStatus.processing
    await db.commit()

    # Queue AI jobs
    redis = None
    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis for bulk analyze: {e}")
        # Roll back status changes
        for item in items_to_process:
            item.status = ItemStatus.error
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to connect to job queue",
        ) from None

    try:
        for item in items_to_process:
            try:
                full_image_path = f"{settings.storage_path}/{item.image_path}"
                await redis.enqueue_job(
                    "tag_item_image",
                    str(item.id),
                    full_image_path,
                    _queue_name="arq:tagging",
                )
                logger.info(f"Queued AI re-analysis for item {item.id}")
                queued += 1
            except Exception as e:
                logger.error(f"Failed to queue AI analysis for {item.id}: {e}")
                errors.append(f"Failed to queue analysis for item {item.id}")
                item.status = ItemStatus.error
                failed += 1

        await db.commit()
    finally:
        if redis:
            await redis.aclose()

    return BulkAnalyzeResponse(queued=queued, failed=failed, errors=errors)


@router.get("/stats", response_model=WardrobeStats)
async def get_wardrobe_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WardrobeStats:
    """What the "your wardrobe is still small" nudge needs to be honest about."""
    counts = await ItemService(db).get_wardrobe_counts(current_user.id)
    return WardrobeStats(
        **counts,
        min_for_looks=MIN_CANDIDATES_FOR_OUTFIT,
        variety_target=VARIETY_TARGET_ITEMS,
        max_batch=settings.max_bulk_upload_count,
    )


@router.get("/types")
async def get_item_types(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    item_service = ItemService(db)
    return await item_service.get_item_types(current_user.id)


@router.get("/colors")
async def get_color_distribution(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    item_service = ItemService(db)
    return await item_service.get_color_distribution(current_user.id)


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    return ItemResponse.model_validate(item)


@router.patch("/{item_id}", response_model=ItemResponse)
async def update_item(
    item_id: UUID,
    item_data: ItemUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if "source_url" in item_data.model_fields_set:
        item_data.source_url = _clean_source_url(item_data.source_url)

    update_data = item_data.model_dump(exclude_unset=True)
    if any(_has_tag_content(f, update_data.get(f)) for f in TAG_WRITEBACK_FIELDS):
        item.tagging_status = TaggingStatus.tagged
        item.tagged_by = TaggedBy.manual
        item.tagged_at = datetime.now(UTC)

    item = await item_service.update(item, item_data)
    return ItemResponse.model_validate(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    image_service = ImageService()
    image_service.delete_images(
        {
            "image_path": item.image_path,
            "medium_path": item.medium_path,
            "thumbnail_path": item.thumbnail_path,
            "original_backup_path": item.original_image_path,
        }
    )

    await item_service.delete(item)


@router.post("/{item_id}/archive", response_model=ItemResponse)
async def archive_item(
    item_id: UUID,
    request: ArchiveRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    item = await item_service.archive(item, request.reason)
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/restore", response_model=ItemResponse)
async def restore_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    item = await item_service.restore(item)
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/wear", response_model=ItemResponse)
async def log_item_wear(
    item_id: UUID,
    request: LogWearRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Use user's timezone to determine today if worn_at not provided
    if request.worn_at is None:
        try:
            user_tz = ZoneInfo(current_user.timezone or "UTC")
        except Exception:
            user_tz = ZoneInfo("UTC")
        worn_at = datetime.now(UTC).astimezone(user_tz).date()
    else:
        worn_at = request.worn_at

    await item_service.log_wear(
        item=item,
        worn_at=worn_at,
        occasion=request.occasion,
        notes=request.notes,
    )

    # Re-fetch rather than refresh(): a plain refresh drops the eagerly loaded
    # `additional_images`, and serialising the response then lazy-loads it on an
    # async session, which is a hard error.
    item = await item_service.get_by_id(item_id, current_user.id)
    return ItemResponse.model_validate(item)


@router.get("/{item_id}/history")
async def get_item_history(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(10, ge=1, le=100),
) -> list[dict]:
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    from app.models.item import ItemHistory
    from app.models.outfit import Outfit, OutfitItem

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Eagerly load outfit and its items for context
    result = await db.execute(
        sa_select(ItemHistory)
        .where(ItemHistory.item_id == item_id)
        .options(
            selectinload(ItemHistory.outfit)
            .selectinload(Outfit.items)
            .selectinload(OutfitItem.item)
        )
        .order_by(ItemHistory.worn_at.desc())
        .limit(limit)
    )
    history = list(result.scalars().all())

    entries = []
    for h in history:
        entry = {
            "id": str(h.id),
            "worn_at": h.worn_at.isoformat(),
            "occasion": h.occasion,
            "notes": h.notes,
        }
        if h.outfit:
            from app.utils.signed_urls import sign_image_url

            entry["outfit"] = {
                "id": str(h.outfit.id),
                "occasion": h.outfit.occasion,
                "items": [
                    {
                        "id": str(oi.item.id),
                        "type": oi.item.type,
                        "name": oi.item.name,
                        "thumbnail_url": sign_image_url(oi.item.thumbnail_path)
                        if oi.item.thumbnail_path
                        else None,
                    }
                    for oi in sorted(h.outfit.items, key=lambda x: x.position)
                ],
            }
        entries.append(entry)

    return entries


@router.get("/{item_id}/wear-stats")
async def get_item_wear_stats(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    return await item_service.get_wear_stats(item, current_user.timezone or "UTC")


@router.get("/{item_id}/usage", response_model=ItemUsageResponse)
async def get_item_usage(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemUsageResponse:
    """Veces puesta, última vez, coste por uso y con qué suele combinarse.

    Co-wear is counted over looks the user confirmed as worn — see
    ``app.services.wardrobe_usage``.
    """
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    usage = await item_usage(db, item, get_user_today(current_user))
    return ItemUsageResponse.model_validate(usage, from_attributes=True)


@router.post("/{item_id}/wash", response_model=ItemResponse)
async def log_item_wash(
    item_id: UUID,
    request: LogWashRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if item.wears_since_wash == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item is already clean (0 wears since last wash)",
        )

    # Use user's timezone to determine today if washed_at not provided
    if request.washed_at is None:
        try:
            user_tz = ZoneInfo(current_user.timezone or "UTC")
        except Exception:
            user_tz = ZoneInfo("UTC")
        washed_at = datetime.now(UTC).astimezone(user_tz).date()
    else:
        washed_at = request.washed_at

    await item_service.log_wash(
        item=item,
        washed_at=washed_at,
        method=request.method,
        notes=request.notes,
    )

    await db.refresh(item)
    return ItemResponse.model_validate(item)


@router.get("/{item_id}/wash-history", response_model=list[WashHistoryResponse])
async def get_item_wash_history(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(10, ge=1, le=100),
) -> list[WashHistoryResponse]:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    history = await item_service.get_wash_history(item_id, limit)
    return [WashHistoryResponse.model_validate(h) for h in history]


@router.post("/{item_id}/analyze", response_model=dict)
async def trigger_ai_analysis(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if not await _can_auto_tag(db, current_user):
        await item_service.mark_pending(item, set_ready=True)
        await db.commit()
        return {"status": "deferred", "reason": "ai_not_enabled"}

    try:
        item.status = ItemStatus.processing
        await db.commit()

        redis = await create_pool(get_redis_settings())
        try:
            full_image_path = f"{settings.storage_path}/{item.image_path}"
            job = await redis.enqueue_job(
                "tag_item_image",
                str(item.id),
                full_image_path,
                _queue_name="arq:tagging",
            )
            item.ai_job_id = job.job_id
            await db.commit()
            logger.info(f"Queued AI re-analysis job for item {item.id}")
            return {"status": "queued", "job_id": job.job_id}
        finally:
            await redis.aclose()
    except Exception as e:
        logger.error(f"Failed to queue AI analysis job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to queue AI analysis",
        ) from None


@router.post("/{item_id}/retag", response_model=ItemResponse)
async def retag_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    item = await item_service.mark_pending(item)
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/cancel-analysis", response_model=ItemResponse)
async def cancel_item_analysis(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if item.status != ItemStatus.processing:
        return ItemResponse.model_validate(item)

    if item.ai_job_id:
        redis = None
        try:
            redis = await create_pool(get_redis_settings())
            job = Job(item.ai_job_id, redis, _queue_name="arq:tagging")
            await job.abort(timeout=5)
        except Exception as e:
            # abort failing or timing out must not block the status flip below;
            # the guarded UPDATE in update_item_status_to_error protects against
            # a stray worker finishing this job after we've already flipped it.
            logger.warning(f"Failed to abort AI job for item {item_id}: {e}")
        finally:
            if redis:
                await redis.aclose()

    await db.execute(
        update(ClothingItem)
        .where(ClothingItem.id == item.id, ClothingItem.status == ItemStatus.processing)
        .values(status=ItemStatus.ready, ai_job_id=None)
    )
    await db.commit()
    # updated_at is recomputed by a DB-side trigger on UPDATE, so the Core update()
    # above leaves the in-memory value stale; refresh it explicitly alongside the
    # columns we changed instead of a bare refresh(), which would also expire the
    # already eager-loaded additional_images relationship and blow up serialization.
    await db.refresh(item, attribute_names=["status", "ai_job_id", "updated_at"])
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/rotate", response_model=ItemResponse)
async def rotate_item_image(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    direction: str = Query(
        "cw",
        regex="^(cw|ccw)$",
        description="Rotation direction: cw (clockwise) or ccw (counter-clockwise)",
    ),
    quarters: int = Query(
        1,
        ge=1,
        le=3,
        description="How many 90 degree steps to turn, so several taps on the "
        "button collapse into one request and one re-encode",
    ),
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if not item.image_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item has no image",
        )

    try:
        image_service = ImageService()
        # Off the event loop: a turn rewrites three files, and a batch of garments
        # being straightened must not queue up behind each other.
        await asyncio.to_thread(image_service.rotate_image, item.image_path, direction, quarters)
        await db.commit()
        # Only `updated_at`, never a bare refresh: a bare one expires the
        # eager-loaded `additional_images` relationship too, and serialising the
        # response then attempts lazy IO on an async session and fails
        # (MissingGreenlet) — which is to say straightening a garment that has a
        # second photo used to 500. A turn changes files on disk and no column, so
        # there is nothing else to read back.
        await db.refresh(item, attribute_names=["updated_at"])
        return ItemResponse.model_validate(item)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None
    except Exception as e:
        logger.error(f"Failed to rotate image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to rotate image",
        ) from None


@router.post("/{item_id}/remove-background", response_model=ItemResponse)
async def remove_item_background(
    item_id: UUID,
    request: RemoveBackgroundRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if not item.image_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item has no image",
        )

    try:
        image_service = ImageService()
        # No bg_color: the cut-out keeps its alpha channel. The request's colour is
        # the flat-image fallback, and flattening now happens where a flat image is
        # actually needed (sharing, export, the vision model).
        result = await asyncio.to_thread(image_service.remove_background, item.image_path)
        previous = _adopt_paths(item, result)
        item.original_image_path = result["original_backup_path"]
        await db.commit()
        await db.refresh(
            item,
            attribute_names=[
                "image_path",
                "medium_path",
                "thumbnail_path",
                "original_image_path",
                "updated_at",
            ],
        )
        image_service.delete_replaced(
            previous, [item.image_path, item.medium_path, item.thumbnail_path]
        )
        return ItemResponse.model_validate(item)
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Background removal provider not available. "
            "For rembg: pip install rembg[cpu]. "
            "For HTTP provider: set BG_REMOVAL_PROVIDER=http and BG_REMOVAL_URL.",
        ) from None
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None
    except Exception as e:
        logger.error(f"Failed to remove background: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove background",
        ) from None


#: A brush mask is a PNG the size of the picture the user painted on, so it is
#: bounded by the image it edits rather than by anything the client chooses.
MAX_BRUSH_MASK_BYTES = 8 * 1024 * 1024


async def _read_brush_mask(mask: UploadFile) -> bytes:
    """The painted mask, validated before it reaches Pillow."""
    data = await mask.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty brush mask",
        )
    if len(data) > MAX_BRUSH_MASK_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Brush mask is too large",
        )
    try:
        with Image.open(BytesIO(data)) as probe:
            probe.verify()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Brush mask is not a readable image",
        ) from None
    return data


async def _rerender_cutout(
    db: AsyncSession,
    item: ClothingItem,
    render: Callable[[], dict[str, str]],
) -> ItemResponse:
    """Swap an item onto freshly written image files, then bin the old ones.

    Shared by the eraser and its reset: both re-render all three sizes under new
    names (a photo becomes a ``.webp`` cut-out the first time), so both have to
    move the item across and only then delete what it used to point at.
    """
    result = await asyncio.to_thread(render)
    previous = _adopt_paths(item, result)
    item.original_image_path = result["original_backup_path"]
    await db.commit()
    await db.refresh(
        item,
        attribute_names=[
            "image_path",
            "medium_path",
            "thumbnail_path",
            "original_image_path",
            "updated_at",
        ],
    )
    image_service = ImageService()
    image_service.delete_replaced(
        previous, [item.image_path, item.medium_path, item.thumbnail_path]
    )
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/cutout-mask", response_model=ItemResponse)
async def brush_item_cutout(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    mask: UploadFile = File(..., description="RGBA PNG: red erases, green restores"),
    space: str = Form(
        "cutout",
        description="Where the strokes were painted: 'cutout' (the visible cut-out) "
        "or 'original' (the whole stored photo)",
    ),
) -> ItemResponse:
    """Edit the garment's transparency by hand — "borra lo que sobra".

    The model gets interior holes wrong often enough — a halter neckline, a bag
    handle — that the user needs a way to finish the job, and the fix has to land
    on the stored alpha so that every screen shows the corrected cut-out
    afterwards, not just the one the user was looking at.
    """
    if space not in ("cutout", "original"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="space must be 'cutout' or 'original'",
        )

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if not item.image_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item has no image")

    data = await _read_brush_mask(mask)
    image_service = ImageService()
    stored_path = item.image_path
    backup = item.original_image_path

    try:
        return await _rerender_cutout(
            db,
            item,
            lambda: image_service.brush_cutout(
                stored_path, data, backup_path=backup, mask_space=space
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to edit cut-out for item {item_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to edit the cut-out",
        ) from None


@router.delete("/{item_id}/cutout-mask", response_model=ItemResponse)
async def reset_item_cutout(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    """Throw away the user's brush strokes and go back to the automatic cut-out."""
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if not item.image_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item has no image")

    image_service = ImageService()
    stored_path = item.image_path
    backup = item.original_image_path

    try:
        return await _rerender_cutout(
            db,
            item,
            lambda: image_service.reset_cutout(stored_path, backup_path=backup),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to reset cut-out for item {item_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset the cut-out",
        ) from None


@router.post("/{item_id}/restore-original", response_model=ItemResponse)
async def restore_item_original(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    if not item.original_image_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No original image to restore",
        )

    try:
        image_service = ImageService()
        restored = await asyncio.to_thread(
            image_service.restore_original, item.image_path, item.original_image_path
        )
        previous = _adopt_paths(item, restored)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None
    except Exception as e:
        logger.error(f"Failed to restore original image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to restore original image",
        ) from None

    item.original_image_path = None
    await db.commit()
    await db.refresh(
        item,
        attribute_names=[
            "image_path",
            "medium_path",
            "thumbnail_path",
            "original_image_path",
            "updated_at",
        ],
    )
    image_service.delete_replaced(
        previous, [item.image_path, item.medium_path, item.thumbnail_path]
    )
    return ItemResponse.model_validate(item)


@router.put("/{item_id}/image", response_model=ItemResponse)
async def replace_item_image(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
) -> ItemResponse:
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    image_service = ImageService()
    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    try:
        image_paths = await image_service.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename=image.filename or "upload.jpg",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None

    old_paths = {
        "image_path": item.image_path,
        "medium_path": item.medium_path,
        "thumbnail_path": item.thumbnail_path,
        "original_backup_path": item.original_image_path,
    }

    item.image_path = image_paths["image_path"]
    item.medium_path = image_paths["medium_path"]
    item.thumbnail_path = image_paths["thumbnail_path"]
    item.image_hash = image_paths["image_hash"]
    item.original_image_path = None
    await db.commit()
    await db.refresh(
        item,
        attribute_names=[
            "image_path",
            "medium_path",
            "thumbnail_path",
            "image_hash",
            "original_image_path",
            "updated_at",
        ],
    )

    # Old files are removed only after the new paths are committed, so a failed
    # commit cannot leave the item pointing at deleted files
    image_service.delete_images(old_paths)

    return ItemResponse.model_validate(item)


@router.post(
    "/{item_id}/images", response_model=ItemImageResponse, status_code=status.HTTP_201_CREATED
)
async def add_item_image(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
    image_view: str | None = Form(
        None,
        description=(
            "front | back | detail. Left out, the first extra photo becomes the "
            "back and the rest details."
        ),
    ),
    remove_background: bool = Form(
        True,
        description="Cut the garment out of this photo too, exactly as the first one.",
    ),
) -> ItemImageResponse:
    """Add another photo of a garment, labelled with the side it shows.

    Deliberately no AI: the vision model only ever sees a garment's primary photo,
    so a back or a detail shot never costs a tagging call and never overwrites the
    tags the front photo earned. Background removal is not AI in that sense — it is
    a local matting pass — and it does run here, because a back photo that keeps its
    white box would stand out against the cut-outs in a flat lay.
    """
    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    # Check max images limit
    from sqlalchemy import func, select

    count_result = await db.execute(select(func.count()).where(ItemImage.item_id == item_id))
    current_count = count_result.scalar() or 0
    if current_count >= MAX_EXTRA_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum of {MAX_EXTRA_IMAGES} additional images per item",
        )

    # Process image
    image_service_inst = ImageService()
    content = await image.read()
    content_type = image.content_type or "application/octet-stream"

    if not image_service_inst.validate_image(content, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file. Supported formats: JPEG, PNG, WebP, HEIC",
        )

    try:
        image_paths = await image_service_inst.process_and_store(
            user_id=current_user.id,
            image_data=content,
            original_filename=image.filename or "upload.jpg",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from None

    # The cut-out is the same local matting pass the first photo goes through, and
    # it is allowed to fail: a photo with its background still on is worth keeping.
    if remove_background:
        try:
            cutout = await asyncio.to_thread(
                image_service_inst.remove_background, image_paths["image_path"]
            )
            image_service_inst.delete_replaced(
                [
                    image_paths["image_path"],
                    image_paths.get("medium_path"),
                    image_paths.get("thumbnail_path"),
                ],
                [cutout["image_path"], cutout.get("medium_path"), cutout.get("thumbnail_path")],
            )
            image_paths = cutout
        except Exception as exc:  # noqa: BLE001 — never lose the photo over this
            logger.warning(f"Background removal failed for extra image of {item_id}: {exc}")

    item_image = ItemImage(
        item_id=item_id,
        image_path=image_paths["image_path"],
        thumbnail_path=image_paths.get("thumbnail_path"),
        medium_path=image_paths.get("medium_path"),
        position=current_count,
        image_view=_default_extra_view(current_count, image_view),
        # Per photo, so undoing the eraser here cannot reach the garment's main photo.
        original_image_path=image_paths.get("original_backup_path"),
    )
    db.add(item_image)
    await db.flush()
    await db.refresh(item_image)

    return ItemImageResponse.model_validate(item_image)


@router.patch("/{item_id}/images/{image_id}/view", response_model=ItemImageResponse)
async def set_item_image_view(
    item_id: UUID,
    image_id: UUID,
    request: SetImageViewRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemImageResponse:
    """Relabel one extra photo — the user correcting our guess."""
    from sqlalchemy import select

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()

    if not item_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    item_image.image_view = request.image_view
    await db.flush()
    await db.refresh(item_image)
    return ItemImageResponse.model_validate(item_image)


@router.delete("/{item_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item_image(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    from sqlalchemy import select

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()

    if not item_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Delete image files
    image_service_inst = ImageService()
    image_service_inst.delete_images(
        {
            "image_path": item_image.image_path,
            "medium_path": item_image.medium_path,
            "thumbnail_path": item_image.thumbnail_path,
            # Its own untouched original goes with it: nothing else points at it.
            "original_backup_path": item_image.original_image_path,
        }
    )

    await db.delete(item_image)
    await db.flush()


@router.patch("/{item_id}/images/reorder", response_model=list[ItemImageResponse])
async def reorder_item_images(
    item_id: UUID,
    request: ReorderImagesRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ItemImageResponse]:
    from sqlalchemy import select

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(select(ItemImage).where(ItemImage.item_id == item_id))
    images = {img.id: img for img in result.scalars().all()}

    for position, img_id in enumerate(request.image_ids):
        if img_id in images:
            images[img_id].position = position

    await db.flush()

    # Return in new order
    ordered = sorted(images.values(), key=lambda x: x.position)
    return [ItemImageResponse.model_validate(img) for img in ordered]


@router.post("/{item_id}/images/{image_id}/set-primary", response_model=ItemResponse)
async def set_primary_image(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemResponse:
    from sqlalchemy import select

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()

    if not item_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Swap paths: current primary -> additional, additional -> primary. The views
    # travel with the photos, not with the slots: promoting the back photo makes the
    # garment's main photo a back photo, and the old front is still a front.
    old_primary = {
        "image_path": item.image_path,
        "thumbnail_path": item.thumbnail_path,
        "medium_path": item.medium_path,
        "image_view": normalize_image_view(item.image_view),
    }

    item.image_path = item_image.image_path
    item.thumbnail_path = item_image.thumbnail_path
    item.medium_path = item_image.medium_path
    item.image_view = normalize_image_view(item_image.image_view)

    item_image.image_path = old_primary["image_path"]
    item_image.thumbnail_path = old_primary["thumbnail_path"]
    item_image.medium_path = old_primary["medium_path"]
    item_image.image_view = old_primary["image_view"]

    await db.flush()
    # The gallery has to be reloaded by name, not left to `refresh()` to expire: the
    # response serialises `additional_images`, and reading an expired relationship
    # outside the greenlet is a MissingGreenlet dressed up as a 422.
    await db.refresh(item, attribute_names=["additional_images", "updated_at"])
    return ItemResponse.model_validate(item)


@router.post("/{item_id}/images/{image_id}/remove-background", response_model=ItemImageResponse)
async def remove_item_image_background(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemImageResponse:
    """Cut the garment out of one *extra* photo.

    Background removal is per photo, not per garment: the back shot of a jumper
    deserves the same treatment as its front, and until it gets it the flat lay has
    to draw it as a white-backed tile among cut-outs. Uploading an extra photo
    already does this; this endpoint is for the ones uploaded before it did.
    """
    from sqlalchemy import select

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()

    if not item_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    try:
        image_service = ImageService()
        paths = await asyncio.to_thread(image_service.remove_background, item_image.image_path)
        previous = [item_image.image_path, item_image.medium_path, item_image.thumbnail_path]
        item_image.image_path = paths["image_path"]
        item_image.medium_path = paths.get("medium_path")
        item_image.thumbnail_path = paths.get("thumbnail_path")
        item_image.original_image_path = paths["original_backup_path"]
        await db.commit()
        await db.refresh(item_image)
        image_service.delete_replaced(
            previous, [item_image.image_path, item_image.medium_path, item_image.thumbnail_path]
        )
        return ItemImageResponse.model_validate(item_image)
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Background removal provider not available.",
        ) from None
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to remove background from extra image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove background",
        ) from None


@router.post("/{item_id}/images/{image_id}/restore-original", response_model=ItemImageResponse)
async def restore_item_image_original(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemImageResponse:
    """Put one extra photo's untouched original back.

    The twin of the per-photo eraser, and the reason the original is stored per photo:
    a back photo whose cut-out came out badly is a fact about that photo, and undoing
    it must leave the garment's own photo — and the garment's data — exactly as they
    were.
    """
    from sqlalchemy import select

    item_service = ItemService(db)
    item = await item_service.get_by_id(item_id, current_user.id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()
    if not item_image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    if not item_image.original_image_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail("no_original"),
        )

    try:
        image_service = ImageService()
        paths = await asyncio.to_thread(
            image_service.restore_original,
            item_image.image_path,
            item_image.original_image_path,
        )
        previous = [item_image.image_path, item_image.medium_path, item_image.thumbnail_path]
        item_image.image_path = paths["image_path"]
        item_image.medium_path = paths.get("medium_path")
        item_image.thumbnail_path = paths.get("thumbnail_path")
        item_image.original_image_path = None
        await db.commit()
        await db.refresh(item_image)
        image_service.delete_replaced(
            previous, [item_image.image_path, item_image.medium_path, item_image.thumbnail_path]
        )
        return ItemImageResponse.model_validate(item_image)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to restore an extra image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to restore the original photo",
        ) from None


async def _load_extra_image(
    db: AsyncSession,
    item_service: ItemService,
    item_id: UUID,
    image_id: UUID,
    user_id: UUID,
) -> ItemImage:
    """One extra photo of one of the caller's garments, or a 404 that says nothing."""
    from sqlalchemy import select

    item = await item_service.get_by_id(item_id, user_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    result = await db.execute(
        select(ItemImage).where(ItemImage.id == image_id, ItemImage.item_id == item_id)
    )
    item_image = result.scalar_one_or_none()
    if not item_image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return item_image


async def _rerender_image_cutout(
    db: AsyncSession,
    item_image: ItemImage,
    render: Callable[[], dict[str, str]],
) -> ItemImageResponse:
    """`_rerender_cutout` for an extra photo: the same swap, on a row of its own.

    Deliberately one photo at a time. The garment's row is never touched, and
    `image_view` is not among the columns that move, so erasing the background off a
    back shot leaves it labelled "detrás" and leaves the front alone.
    """
    result = await asyncio.to_thread(render)
    previous = [item_image.image_path, item_image.medium_path, item_image.thumbnail_path]
    item_image.image_path = result["image_path"]
    item_image.medium_path = result.get("medium_path")
    item_image.thumbnail_path = result.get("thumbnail_path")
    item_image.original_image_path = result["original_backup_path"]
    await db.commit()
    await db.refresh(item_image)
    image_service = ImageService()
    image_service.delete_replaced(
        previous, [item_image.image_path, item_image.medium_path, item_image.thumbnail_path]
    )
    return ItemImageResponse.model_validate(item_image)


@router.post("/{item_id}/images/{image_id}/rotate", response_model=ItemImageResponse)
async def rotate_item_image_photo(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    direction: str = Query(
        "cw",
        regex="^(cw|ccw)$",
        description="Rotation direction: cw (clockwise) or ccw (counter-clockwise)",
    ),
    quarters: int = Query(
        1,
        ge=1,
        le=3,
        description="How many 90 degree steps to turn, so several taps on the "
        "button collapse into one request and one re-encode",
    ),
) -> ItemImageResponse:
    """Straighten one *extra* photo.

    A back shot arrives sideways exactly as often as a front one, and the garment's
    own photo was the only one that could be turned. Rewrites this photo's three
    sizes in place — the filenames do not change, so there is no column to move and
    no other photo to disturb — and turns its sidecar alpha with it, so a back shot
    that was erased by hand stays erased after being straightened.
    """
    item_service = ItemService(db)
    item_image = await _load_extra_image(db, item_service, item_id, image_id, current_user.id)

    try:
        image_service = ImageService()
        # Off the event loop, for the same reason the garment's own turn is: a turn
        # rewrites three files and a batch must not queue up behind itself.
        await asyncio.to_thread(
            image_service.rotate_image, item_image.image_path, direction, quarters
        )
        await db.commit()
        await db.refresh(item_image)
        return ItemImageResponse.model_validate(item_image)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to rotate image {image_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to rotate image",
        ) from None


@router.post("/{item_id}/images/{image_id}/cutout-mask", response_model=ItemImageResponse)
async def brush_item_image_cutout(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    mask: UploadFile = File(..., description="RGBA PNG: red erases, green restores"),
    space: str = Form(
        "cutout",
        description="Where the strokes were painted: 'cutout' (the visible cut-out) "
        "or 'original' (the whole stored photo)",
    ),
) -> ItemImageResponse:
    """«Borra lo que sobra» on an *extra* photo — the back shot, usually.

    The garment-level eraser can only reach the garment's own photo, and once a photo
    can say which side it shows there is no reason the back should be the one nobody
    can touch up: a halter neckline is as enclosed from behind as from the front. The
    strokes land on this photo's stored alpha and on nothing else — every size is
    re-rendered under this row's own stem, so the front keeps whatever it had.
    """
    if space not in ("cutout", "original"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="space must be 'cutout' or 'original'",
        )

    item_service = ItemService(db)
    item_image = await _load_extra_image(db, item_service, item_id, image_id, current_user.id)

    data = await _read_brush_mask(mask)
    image_service = ImageService()
    stored_path = item_image.image_path
    backup = item_image.original_image_path

    try:
        return await _rerender_image_cutout(
            db,
            item_image,
            lambda: image_service.brush_cutout(
                stored_path, data, backup_path=backup, mask_space=space
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to edit the cut-out of image {image_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to edit the cut-out",
        ) from None


@router.delete("/{item_id}/images/{image_id}/cutout-mask", response_model=ItemImageResponse)
async def reset_item_image_cutout(
    item_id: UUID,
    image_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ItemImageResponse:
    """Back to the automatic cut-out, for this one extra photo."""
    item_service = ItemService(db)
    item_image = await _load_extra_image(db, item_service, item_id, image_id, current_user.id)

    image_service = ImageService()
    stored_path = item_image.image_path
    backup = item_image.original_image_path

    try:
        return await _rerender_image_cutout(
            db,
            item_image,
            lambda: image_service.reset_cutout(stored_path, backup_path=backup),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    except Exception as e:
        logger.error(f"Failed to reset the cut-out of image {image_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset the cut-out",
        ) from None


@router.post("/{item_id}/merge-from", response_model=MergeItemResponse)
async def merge_item_into(
    item_id: UUID,
    request: MergeItemRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MergeItemResponse:
    """«Esta es la espalda de aquella»: fold one garment's photos into another.

    Nothing guesses at this. A front and a back shot of the same jumper look nothing
    alike, the pHash duplicate check is not built for it, and no model is asked: the
    user is the only one who knows, so the user says it. Two screens ask — the quick
    pass after a batch, and any garment already sitting in the wardrobe, uploaded
    long before views existed — and both land here.

    **The garment we keep keeps everything.** Its name, type, colour (the family and
    the shade sampled off it), brand, price, style, formality, season, usage
    preference, wear and wash history, counters: none of it is touched, and nothing
    from the folded-in garment overwrites any of it. This is not a two-way merge of
    two records — it is one garment gaining a photo. The folded-in garment's own tags
    are discarded, because they describe a photo the user has just told us is the
    *back* of something already tagged.

    **Only the photos move.** The folded-in garment's main photo becomes a photo of
    the keeper labelled with ``image_view`` (``back`` unless the user says otherwise),
    and its extra photos come along keeping the labels they already had. Each photo
    keeps its own cut-out state and its own untouched original, so a bad cut-out on
    the back is fixed on the back and cannot reach the keeper's own photo.

    No AI is called. Not to decide the merge, and not to re-tag afterwards: the
    vision model only ever sees a garment's primary photo, and the photo that just
    arrived is not one.

    **Nothing is lost instead of being merged.** A garment with a wear history, a
    wash history, or a place in a look is not a stray photo, and folding it away would
    either throw that away or write it onto the keeper — so it is refused, by name,
    and the user is told what is in the way. The one place this is reversible is the
    quick pass after a batch, where it is still a draft until the pass is saved;
    anywhere else it is final, and the UI says so before asking.

    A retry is a success, not a 404: if the garment being folded in is already gone,
    the response says ``merged: false`` and hands back the keeper untouched.
    """
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import func, select

    from app.models.item import ItemHistory, WashHistory
    from app.models.outfit import Outfit, OutfitItem

    item_service = ItemService(db)
    target = await item_service.get_by_id(item_id, current_user.id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    if request.item_id == item_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail("same_item"),
        )

    source = await item_service.get_by_id(request.item_id, current_user.id)
    if source is None:
        # Already folded in (a retry), or never the caller's to begin with. Either way
        # the honest answer is "nothing to do", and it leaks nothing about whose it was.
        return MergeItemResponse(item=ItemResponse.model_validate(target), merged=False)

    # A garment with a past is not a stray photo. Refusing keeps both promises at
    # once: nothing of the keeper's is overwritten, and nothing of the other one's is
    # quietly binned.
    async def count(model, column) -> int:
        return (await db.execute(select(func.count()).where(column == source.id))).scalar() or 0

    blockers: list[str] = []
    if await count(ItemHistory, ItemHistory.item_id) or (source.wear_count or 0) > 0:
        blockers.append("wear_history")
    if await count(WashHistory, WashHistory.item_id):
        blockers.append("wash_history")
    if await count(OutfitItem, OutfitItem.item_id):
        blockers.append("outfits")
    if await count(Outfit, Outfit.source_item_id):
        blockers.append("pairings")
    if blockers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={**error_detail("source_in_use"), "blockers": blockers},
        )

    # The keeper's own photo stays the keeper's; everything the other one had becomes
    # an extra photo of the keeper, which is what the four-photo ceiling counts.
    existing = (
        await db.execute(select(func.count()).where(ItemImage.item_id == item_id))
    ).scalar() or 0
    incoming = 1 + len(source.additional_images)
    if existing + incoming > MAX_EXTRA_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail("too_many_images"),
        )

    position = existing
    db.add(
        ItemImage(
            item_id=item_id,
            image_path=source.image_path,
            thumbnail_path=source.thumbnail_path,
            medium_path=source.medium_path,
            # The untouched photo from before this one's background was removed travels
            # with it, so "deshacer quitar fondo" on the back undoes the back.
            original_image_path=source.original_image_path,
            position=position,
            image_view=request.image_view,
        )
    )
    position += 1
    for extra in sorted(source.additional_images, key=lambda i: i.position):
        db.add(
            ItemImage(
                item_id=item_id,
                image_path=extra.image_path,
                thumbnail_path=extra.thumbnail_path,
                medium_path=extra.medium_path,
                original_image_path=extra.original_image_path,
                position=position,
                # Kept, not re-guessed: the owner already labelled these.
                image_view=normalize_image_view(extra.image_view),
            )
        )
        position += 1
    await db.flush()
    # The rows go before the garment does, so the cascade cannot take the files' new
    # owner down with it.
    await db.execute(sa_delete(ItemImage).where(ItemImage.item_id == source.id))

    # Deliberately not `delete_item`: that bins the image files, and those files are
    # the keeper's now. The originals travelled with the photos, so they stay too.
    await item_service.delete(source)
    await db.flush()
    # By name, so the photos that just arrived are in the gallery we serialise: the
    # keeper was loaded before they existed.
    await db.refresh(target, attribute_names=["additional_images"])
    return MergeItemResponse(
        item=ItemResponse.model_validate(target),
        merged=True,
        moved_images=incoming,
    )
