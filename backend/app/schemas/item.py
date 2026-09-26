from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.utils.care import MAX_FIBERS, care_hints, normalize_fiber, parse_composition
from app.utils.colors import normalize_hex
from app.utils.image_formats import is_cutout_path
from app.utils.signed_urls import sign_image_url

# Default wash intervals by clothing type (wears between washes)
DEFAULT_WASH_INTERVALS: dict[str, int] = {
    "t-shirt": 1,
    "shirt": 2,
    "blouse": 2,
    "pants": 4,
    "jeans": 6,
    "shorts": 3,
    "dress": 2,
    "skirt": 3,
    "sweater": 5,
    "hoodie": 4,
    "jacket": 8,
    "coat": 10,
    "blazer": 5,
    "suit": 5,
    "shoes": 15,
    "accessories": 20,
    "other": 3,
}


#: What the owner told us to do with one garment. "rest" («déjala tranquila»)
#: only stops the nudging — archiving is what takes a garment out of play.
UsagePreference = Literal["more", "normal", "rest"]


class ItemTags(BaseModel):
    colors: list[str] = Field(default_factory=list)
    primary_color: str | None = None
    pattern: str | None = None
    material: str | None = None
    style: list[str] = Field(default_factory=list)
    season: list[str] = Field(default_factory=list)
    formality: str | None = None
    fit: str | None = None


class CareComposition(BaseModel):
    """One fibre of a garment's composition, e.g. 60% cotton."""

    fiber: str = Field(max_length=40)
    percent: int | None = Field(None, ge=1, le=100)

    @field_validator("fiber", mode="before")
    @classmethod
    def _normalize_fiber(cls, value: Any) -> Any:
        if isinstance(value, str):
            return normalize_fiber(value) or value.strip()[:40]
        return value


class CareWash(BaseModel):
    machine: bool | None = None
    hand_wash: bool | None = None
    do_not_wash: bool | None = None
    max_temp_c: int | None = Field(None, ge=0, le=95)
    cycle: Literal["normal", "gentle", "delicate"] | None = None


class CareDry(BaseModel):
    tumble_dry: bool | None = None
    tumble_heat: Literal["low", "medium", "high"] | None = None
    line_dry: bool | None = None
    flat_dry: bool | None = None


class CareIron(BaseModel):
    allowed: bool | None = None
    max_temp_c: int | None = Field(None, ge=0, le=220)
    steam: bool | None = None


class CareProfessional(BaseModel):
    dry_clean: bool | None = None
    code: str | None = Field(None, max_length=8)


class CareInfo(BaseModel):
    """Structured care-label data: composition plus the laundry symbols.

    Every field is optional — a label that only says "100% algodón" is as valid
    as a fully symbol-annotated one, and a user without AI fills in whichever
    parts they can read.
    """

    composition: list[CareComposition] = Field(default_factory=list, max_length=MAX_FIBERS)
    wash: CareWash | None = None
    bleach: Literal["any", "non_chlorine", "none"] | None = None
    dry: CareDry | None = None
    iron: CareIron | None = None
    professional: CareProfessional | None = None
    notes: str | None = Field(None, max_length=500)
    source: Literal["ai", "manual"] = "manual"

    @field_validator("composition", mode="before")
    @classmethod
    def _accept_text(cls, value: Any) -> Any:
        """Accept a typed "60% algodón, 40% poliéster" as well as a list."""
        if isinstance(value, str):
            return parse_composition(value)
        if value is None:
            return []
        return value

    def is_empty(self) -> bool:
        return not any(
            (
                self.composition,
                self.wash,
                self.bleach,
                self.dry,
                self.iron,
                self.professional,
                self.notes,
            )
        )


class ItemBase(BaseModel):
    type: str = Field(default="unknown", max_length=50)  # Default to unknown, AI will detect
    subtype: str | None = Field(None, max_length=50)
    name: str | None = Field(None, max_length=100)
    brand: str | None = Field(None, max_length=100)
    notes: str | None = None
    purchase_date: date | None = None
    purchase_price: Decimal | None = Field(None, ge=0)
    favorite: bool = False
    source_url: str | None = Field(None, max_length=2048)
    care: CareInfo | None = None


class ItemCreate(ItemBase):
    tags: ItemTags | None = None
    colors: list[str] | None = None
    primary_color: str | None = None
    # The sampled shade of the garment, "#rrggbb". Display only: `primary_color`
    # stays the family everything else reasons on.
    primary_color_hex: str | None = Field(None, max_length=7)

    @field_validator("primary_color_hex", mode="before")
    @classmethod
    def _normalize_primary_color_hex(cls, value: Any) -> Any:
        """Anything that is not a real hex becomes ``None`` rather than a 422.

        The hex is a nicety on top of the named colour, so a client that sends
        junk loses the shade and keeps the garment.
        """
        if value is None or value == "":
            return None
        return normalize_hex(value) if isinstance(value, str) else None


class ItemUpdate(BaseModel):
    type: str | None = Field(None, min_length=1, max_length=50)
    subtype: str | None = Field(None, max_length=50)
    name: str | None = Field(None, max_length=100)
    brand: str | None = Field(None, max_length=100)
    notes: str | None = None
    purchase_date: date | None = None
    purchase_price: Decimal | None = Field(None, ge=0)
    favorite: bool | None = None
    tags: ItemTags | None = None
    colors: list[str] | None = None
    primary_color: str | None = None
    # Editable by hand, not only by the tagger: the detail editor offers all three.
    style: list[str] | None = None
    formality: str | None = Field(None, max_length=50)
    season: list[str] | None = None
    wash_interval: int | None = None
    source_url: str | None = Field(None, max_length=2048)
    care: CareInfo | None = None
    # The sampled shade of the garment, "#rrggbb". Display only: `primary_color`
    # stays the family everything else reasons on.
    primary_color_hex: str | None = Field(None, max_length=7)
    usage_preference: UsagePreference | None = None

    @field_validator("primary_color_hex", mode="before")
    @classmethod
    def _normalize_primary_color_hex(cls, value: Any) -> Any:
        """Anything that is not a real hex becomes ``None`` rather than a 422.

        The hex is a nicety on top of the named colour, so a client that sends
        junk loses the shade and keeps the garment.
        """
        if value is None or value == "":
            return None
        return normalize_hex(value) if isinstance(value, str) else None


class ItemResponse(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    image_path: str
    thumbnail_path: str | None = None
    medium_path: str | None = None
    original_image_path: str | None = None
    tags: dict = Field(default_factory=dict)
    colors: list[str] = Field(default_factory=list)
    primary_color: str | None = None
    primary_color_hex: str | None = None
    pattern: str | None = None
    material: str | None = None
    style: list[str] = Field(default_factory=list)
    formality: str | None = None
    season: list[str] = Field(default_factory=list)
    status: str
    ai_processed: bool = False
    ai_confidence: Decimal | None = None
    ai_description: str | None = None
    tagging_status: str = "pending"
    tagged_by: str | None = None
    tagged_at: datetime | None = None
    wear_count: int = 0
    usage_preference: UsagePreference = "normal"
    last_worn_at: date | None = None
    last_suggested_at: date | None = None
    suggestion_count: int = 0
    acceptance_count: int = 0
    wears_since_wash: int = 0
    last_washed_at: date | None = None
    wash_interval: int | None = None
    needs_wash: bool = False
    additional_images: list["ItemImageResponse"] = Field(default_factory=list)
    is_archived: bool = False
    archived_at: datetime | None = None
    archive_reason: str | None = None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def image_url(self) -> str:
        return sign_image_url(self.image_path)

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

        The grid draws a flat white-backed photo with `mix-blend-multiply` so the
        tile's tint shows through the white; a real cut-out needs no such trick and
        must not be multiplied, or its own colours would be darkened by the tint.
        """
        return is_cutout_path(self.thumbnail_path or self.image_path)

    @computed_field
    @property
    def medium_url(self) -> str | None:
        if self.medium_path:
            return sign_image_url(self.medium_path)
        return None

    @computed_field
    @property
    def original_image_url(self) -> str | None:
        """The untouched photo, when one was kept aside.

        The eraser needs it: restoring part of a cut-out has to show the pixels that
        were there, and a stored cut-out keeps nothing usable under its own
        transparency. It is the same file "deshacer el recorte" restores from.
        """
        if self.original_image_path:
            return sign_image_url(self.original_image_path)
        return None

    @computed_field
    @property
    def care_hints(self) -> list[str]:
        """Stable codes (``wash_30``, ``no_tumble``…) the frontend localises."""
        if self.care is None:
            return []
        return care_hints(self.care.model_dump())

    @computed_field
    @property
    def effective_wash_interval(self) -> int:
        if self.wash_interval is not None:
            return self.wash_interval
        return DEFAULT_WASH_INTERVALS.get(self.type, 3)


class ItemListResponse(BaseModel):
    items: list[ItemResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


class ItemFilter(BaseModel):
    # An explicit id list, so a client that knows exactly which items it wants
    # (the batch it just uploaded) can poll only those.
    ids: list[UUID] | None = None
    type: str | None = None
    subtype: str | None = None
    colors: list[str] | None = None
    status: str | None = None
    tagging_status: str | None = None
    favorite: bool | None = None
    needs_wash: bool | None = None
    is_archived: bool = False
    search: str | None = None
    sort_by: str | None = None
    sort_order: str = "desc"


class LogWearRequest(BaseModel):
    worn_at: date | None = None  # If None, use user's timezone to determine today
    occasion: str | None = None
    notes: str | None = None


class ArchiveRequest(BaseModel):
    reason: str | None = Field(None, max_length=50)


class BulkUploadResult(BaseModel):
    """One photo of a bulk upload, and what became of it.

    `success` is kept as it was for existing callers. `state` is what a queue row
    shows, and it draws the distinction `success` cannot: a duplicate is not a
    failure the user caused, it is a photo the wardrobe already has, and `item`
    then points at the one that is already there.
    """

    filename: str
    success: bool
    state: Literal["created", "duplicate", "error"] = "created"
    item: ItemResponse | None = None
    # A code the UI can turn into a specific sentence: too_big, invalid_format,
    # duplicate, too_many_images, failed. `error` stays as the English fallback.
    error_code: str | None = None
    error: str | None = None
    # "queued" means a worker is tagging it; "skipped" means it is ready but
    # untagged and wants the manual pass.
    tagging: Literal["queued", "skipped"] | None = None
    background_removed: bool = False


class BulkUploadResponse(BaseModel):
    total: int
    successful: int
    failed: int
    results: list[BulkUploadResult]


class WardrobeStats(BaseModel):
    """How full the wardrobe is, and what "full enough" means.

    The thresholds travel with the counts so the UI never hardcodes a number the
    stylist does not actually use.
    """

    total: int
    # Ready and with a real type: what the suggestion engine can build an outfit from.
    usable: int
    # Still "unknown": uploaded but waiting for the AI or for the manual pass.
    untyped: int
    processing: int
    # The suggestion engine's hard floor (RecommendationService).
    min_for_looks: int
    # Not a requirement — the size at which suggestions stop repeating themselves.
    variety_target: int
    # How many photos one batch of the bulk upload may carry.
    max_batch: int


class BulkTagEntry(BaseModel):
    """One garment's worth of the quick pass.

    Type and colour are the two the stylist cannot work without; style and
    formality are what makes the difference between "a shirt" and "a shirt for the
    office", and the review grid asks for each of them. `primary_color_hex` is the
    shade sampled off the photo — display only, beside the colour family.
    """

    item_id: UUID
    type: str | None = Field(None, max_length=50)
    # The detail inside the type ("halter", "plisada" → `pleated`). Unlike `type`, an
    # empty string is meaningful here: the tagger guesses subtype badly and removing
    # a wrong guess is the commonest edit the quick pass makes, so "" clears it while
    # omitting the field leaves whatever is stored alone.
    subtype: str | None = Field(None, max_length=50)
    primary_color: str | None = Field(None, max_length=50)
    # The sampled shade of the garment, "#rrggbb". Display only: `primary_color`
    # stays the family everything else reasons on.
    primary_color_hex: str | None = Field(None, max_length=7)
    style: list[str] | None = Field(None, max_length=6)
    formality: str | None = Field(None, max_length=50)
    season: list[str] | None = Field(None, max_length=6)

    @field_validator("primary_color_hex", mode="before")
    @classmethod
    def _normalize_primary_color_hex(cls, value: Any) -> Any:
        """Anything that is not a real hex becomes ``None`` rather than a 422.

        The hex is a nicety on top of the named colour, so a client that sends
        junk loses the shade and keeps the garment.
        """
        if value is None or value == "":
            return None
        return normalize_hex(value) if isinstance(value, str) else None


class BulkTagRequest(BaseModel):
    """The quick review / manual tagging pass over a batch."""

    items: list[BulkTagEntry] = Field(..., min_length=1, max_length=100)


class BulkTagResponse(BaseModel):
    updated: int
    failed: int
    errors: list[str] = Field(default_factory=list)


class BulkFilters(BaseModel):
    type: str | None = None
    search: str | None = None
    is_archived: bool | None = None


class BulkDeleteRequest(BaseModel):
    # Explicit selection
    item_ids: list[UUID] | None = None

    # Select all with exceptions
    select_all: bool = False
    excluded_ids: list[UUID] | None = None
    filters: BulkFilters | None = None

    def model_post_init(self, __context):
        if not self.select_all and not self.item_ids:
            raise ValueError("Either item_ids or select_all=True must be provided")
        if self.select_all and self.item_ids:
            raise ValueError("Cannot use both item_ids and select_all")


class BulkDeleteResponse(BaseModel):
    deleted: int
    failed: int
    errors: list[str] = Field(default_factory=list)


class BulkAnalyzeRequest(BaseModel):
    # Explicit selection
    item_ids: list[UUID] | None = None

    # Select all with exceptions
    select_all: bool = False
    excluded_ids: list[UUID] | None = None
    filters: BulkFilters | None = None

    def model_post_init(self, __context):
        if not self.select_all and not self.item_ids:
            raise ValueError("Either item_ids or select_all=True must be provided")
        if self.select_all and self.item_ids:
            raise ValueError("Cannot use both item_ids and select_all")


class BulkAnalyzeResponse(BaseModel):
    queued: int
    failed: int
    errors: list[str] = Field(default_factory=list)


class ItemImageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    item_id: UUID
    image_path: str
    thumbnail_path: str | None = None
    medium_path: str | None = None
    position: int
    created_at: datetime

    @computed_field
    @property
    def image_url(self) -> str:
        return sign_image_url(self.image_path)

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

        The grid draws a flat white-backed photo with `mix-blend-multiply` so the
        tile's tint shows through the white; a real cut-out needs no such trick and
        must not be multiplied, or its own colours would be darkened by the tint.
        """
        return is_cutout_path(self.thumbnail_path or self.image_path)

    @computed_field
    @property
    def medium_url(self) -> str | None:
        if self.medium_path:
            return sign_image_url(self.medium_path)
        return None


class ReorderImagesRequest(BaseModel):
    image_ids: list[UUID]


class RemoveBackgroundRequest(BaseModel):
    bg_color: str = Field(
        default="#FFFFFF",
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="Hex color for the replacement background",
    )


class LogWashRequest(BaseModel):
    washed_at: date | None = None  # If None, use user's timezone to determine today
    method: str | None = Field(None, max_length=50)
    notes: str | None = None


class CoWornItemResponse(BaseModel):
    """A garment this one goes out with, and how many worn looks they shared."""

    id: UUID
    name: str | None = None
    type: str
    thumbnail_path: str | None = None
    times: int

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        if self.thumbnail_path:
            return sign_image_url(self.thumbnail_path)
        return None


class ItemUsageResponse(BaseModel):
    """Veces puesta, última vez, coste por uso y con qué suele combinarse."""

    wear_count: int
    last_worn_at: date | None = None
    days_since_last_worn: int | None = None
    purchase_price: Decimal | None = None
    #: None means "we cannot say": no price saved, or nothing worn yet.
    cost_per_wear: Decimal | None = None
    usage_preference: UsagePreference = "normal"
    co_worn: list[CoWornItemResponse] = Field(default_factory=list)
    co_worn_looks: int = 0


class WashHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    item_id: UUID
    washed_at: date
    method: str | None = None
    notes: str | None = None
    created_at: datetime


class LinkPreviewRequest(BaseModel):
    """A shop URL pasted by the user, to be read server-side."""

    url: str = Field(min_length=4, max_length=2048)


class LinkPreviewImage(BaseModel):
    """The product photo, re-encoded by us and inlined for the review screen."""

    data_url: str
    content_type: str
    size_bytes: int


class LinkPreviewResponse(BaseModel):
    """Everything a pasted link gave us. Never creates an item on its own."""

    source_url: str
    extracted: bool
    reason: str | None = None
    name: str | None = None
    brand: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    primary_color: str | None = None
    description: str | None = None
    site_name: str | None = None
    image: LinkPreviewImage | None = None


class CareLabelResponse(BaseModel):
    """What the vision model read off a care-label photo, for the review screen."""

    care: CareInfo
    hints: list[str] = Field(default_factory=list)
    suggested_material: str | None = None
    read: bool = True
