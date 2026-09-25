import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.avatar_service import (
    ALLOWED_AVATAR_MIME_TYPES,
    MAX_AVATAR_BYTES,
    AvatarError,
    CropBox,
    avatar_thumb_url,
    avatar_url,
    delete_avatar_files,
    render_avatar,
    store_avatar,
)
from app.services.location_service import TIMEZONE_SOURCE_MANUAL, round_city_coord
from app.services.user_service import UserService
from app.utils.auth import get_current_user
from app.utils.passwords import (
    PASSWORD_MAX_LENGTH,
    PasswordPolicyError,
    hash_password_async,
    validate_new_password,
    verify_password_async,
)
from app.utils.rate_limit import rate_limit_by_user
from app.utils.timezone import canonical_timezone, is_valid_timezone

USERNAME_REGEX = re.compile(r"^[a-z0-9_]{3,20}$")
# Keys of the first-run guidance ("tour", "tip.wardrobe"...). Free-form so the
# frontend can add tips without a backend change, but short and bounded.
SEEN_TIP_REGEX = re.compile(r"^[a-z][a-z0-9_.-]{0,39}$")
MAX_SEEN_TIPS = 64

router = APIRouter(prefix="/users/me", tags=["Users"])


class OnboardingCompleteResponse(BaseModel):
    onboarding_completed: bool


class UserProfileResponse(BaseModel):
    id: str
    email: str
    username: str | None = None
    bio: str | None = None
    display_name: str
    avatar_url: str | None = None
    avatar_thumb_url: str | None = None
    # True when the avatar is a photo the user uploaded (can be removed).
    has_avatar_photo: bool = False
    timezone: str
    # "auto" (detected) or "manual" (the user picked it). Ajustes shows
    # "detectada automáticamente" for "auto"; detection skips "manual".
    timezone_source: str = "auto"
    location_lat: float | None = None
    location_lon: float | None = None
    location_name: str | None = None
    family_id: str | None = None
    role: str
    onboarding_completed: bool
    body_measurements: dict | None = None
    has_password: bool = False
    password_updated_at: datetime | None = None
    seen_tips: list[str] = Field(default_factory=list)


class UserProfileUpdate(BaseModel):
    display_name: str | None = None
    username: str | None = Field(default=None, min_length=3, max_length=20)
    bio: str | None = Field(default=None, max_length=280)
    timezone: str | None = Field(default=None, max_length=50)
    location_lat: Decimal | None = Field(default=None, ge=-90, le=90)
    location_lon: Decimal | None = Field(default=None, ge=-180, le=180)
    location_name: str | None = Field(default=None, max_length=100)
    body_measurements: dict | None = None

    @field_validator("timezone")
    @classmethod
    def _valid_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = canonical_timezone(value.strip())
        if not is_valid_timezone(value):
            raise ValueError("invalid_timezone")
        return value

    @field_validator("location_name")
    @classmethod
    def _clean_location_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


class SeenTipsUpdate(BaseModel):
    add: list[str] = Field(default_factory=list, max_length=20)
    remove: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("add", "remove")
    @classmethod
    def _valid_keys(cls, value: list[str]) -> list[str]:
        for key in value:
            if not SEEN_TIP_REGEX.match(key):
                raise ValueError("invalid_tip_key")
        return value


class SeenTipsResponse(BaseModel):
    seen_tips: list[str]


class UsernameAvailableResponse(BaseModel):
    available: bool
    reason: str | None = None


@router.get("", response_model=UserProfileResponse)
async def get_profile(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    return _user_response(current_user)


@router.patch("", response_model=UserProfileResponse)
async def update_profile(
    data: UserProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    update_data = data.model_dump(exclude_unset=True)

    # Picking a zone here is a deliberate choice, so detection must never touch
    # it again — but only when the value really changes, or saving the city
    # (which submits the zone alongside it) would freeze detection by accident.
    if update_data.get("timezone") and update_data["timezone"] != current_user.timezone:
        update_data["timezone_source"] = TIMEZONE_SOURCE_MANUAL

    # City level only, wherever the coordinates came from: the stored position is
    # always ~1 km granular, never a precise one.
    for key in ("location_lat", "location_lon"):
        if update_data.get(key) is not None:
            update_data[key] = round_city_coord(update_data[key])

    if "body_measurements" in update_data and update_data["body_measurements"] is not None:
        numeric_keys = {"chest", "waist", "hips", "inseam", "height", "weight"}
        for key, value in update_data["body_measurements"].items():
            if key in numeric_keys and isinstance(value, (int, float)) and value <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{key} must be a positive number",
                )

    if "username" in update_data and update_data["username"] is not None:
        normalized = update_data["username"].lower()
        if not USERNAME_REGEX.match(normalized):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="username must match ^[a-z0-9_]{3,20}$",
            )
        user_service = UserService(db)
        if await user_service.username_taken(normalized, exclude_user_id=current_user.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="username_taken")
        update_data["username"] = normalized
        email_local = (current_user.email or "").split("@")[0].lower()
        current_display = (current_user.display_name or "").strip().lower()
        if "display_name" not in update_data and current_display in ("", email_local):
            update_data["display_name"] = normalized

    for field, value in update_data.items():
        setattr(current_user, field, value)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="username_taken") from None
    await db.refresh(current_user)
    await db.commit()

    return _user_response(current_user)


@router.patch("/seen-tips", response_model=SeenTipsResponse)
async def update_seen_tips(
    data: SeenTipsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SeenTipsResponse:
    """Mark first-run guidance as seen (``add``) or show it again (``remove``).

    Merges into the stored set instead of replacing it, so two devices marking
    different tips at once never lose each other's keys (the row is locked).
    """
    result = await db.execute(
        select(User.seen_tips).where(User.id == current_user.id).with_for_update()
    )
    current = list(result.scalar_one() or [])
    removed = set(data.remove)
    merged = [k for k in current if k not in removed]
    for key in data.add:
        if key not in merged and key not in removed:
            merged.append(key)
    if len(merged) > MAX_SEEN_TIPS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="too_many_seen_tips"
        )
    current_user.seen_tips = merged
    await db.commit()
    return SeenTipsResponse(seen_tips=merged)


@router.get("/username-available", response_model=UsernameAvailableResponse)
async def username_available(
    value: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UsernameAvailableResponse:
    normalized = value.lower()
    if not USERNAME_REGEX.match(normalized):
        return UsernameAvailableResponse(available=False, reason="format")
    user_service = UserService(db)
    taken = await user_service.username_taken(normalized, exclude_user_id=current_user.id)
    return UsernameAvailableResponse(available=not taken, reason=None if not taken else "taken")


def _user_response(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=str(user.id),
        email=user.email,
        username=user.username,
        bio=user.bio,
        display_name=user.display_name,
        avatar_url=avatar_url(user),
        avatar_thumb_url=avatar_thumb_url(user),
        has_avatar_photo=bool(user.avatar_path),
        timezone=user.timezone,
        timezone_source=user.timezone_source,
        location_lat=float(user.location_lat) if user.location_lat else None,
        location_lon=float(user.location_lon) if user.location_lon else None,
        location_name=user.location_name,
        family_id=str(user.family_id) if user.family_id else None,
        role=user.role,
        onboarding_completed=user.onboarding_completed,
        body_measurements=user.body_measurements,
        has_password=bool(user.password_hash),
        password_updated_at=user.password_updated_at,
        seen_tips=list(user.seen_tips or []),
    )


@router.put("/avatar", response_model=UserProfileResponse)
async def upload_avatar(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
    crop_x: float | None = Form(None, ge=0),
    crop_y: float | None = Form(None, ge=0),
    crop_size: float | None = Form(None, gt=0),
) -> UserProfileResponse:
    """Set (or replace) the profile photo.

    The crop square is in pixels of the upright (EXIF-rotated) image; without
    it the centred square is used. Stored as a 512px WebP + 128px thumb with
    all metadata stripped. Error details: unsupported_image_type,
    image_too_large, invalid_image.
    """
    await rate_limit_by_user(current_user.id, "avatar_upload", 20, 3600)

    if (image.content_type or "").lower() not in ALLOWED_AVATAR_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="unsupported_image_type"
        )
    content = await image.read(MAX_AVATAR_BYTES + 1)
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="image_too_large")

    crop = None
    if crop_x is not None and crop_y is not None and crop_size is not None:
        crop = CropBox(x=crop_x, y=crop_y, size=crop_size)
    try:
        full, thumb = await run_in_threadpool(render_avatar, content, crop)
    except AvatarError as e:
        code = 413 if e.code == "image_too_large" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=e.code) from None

    old = (current_user.avatar_path, current_user.avatar_thumb_path)
    new_full, new_thumb = await run_in_threadpool(store_avatar, current_user.id, full, thumb)
    current_user.avatar_path = new_full
    current_user.avatar_thumb_path = new_thumb
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        delete_avatar_files(new_full, new_thumb)
        raise
    delete_avatar_files(*old)
    await db.refresh(current_user)
    return _user_response(current_user)


@router.delete("/avatar", response_model=UserProfileResponse)
async def delete_avatar(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    """Remove the uploaded profile photo (idempotent); initials are shown again."""
    old = (current_user.avatar_path, current_user.avatar_thumb_path)
    if any(old):
        current_user.avatar_path = None
        current_user.avatar_thumb_path = None
        await db.commit()
        delete_avatar_files(*old)
        await db.refresh(current_user)
    return _user_response(current_user)


class PasswordSetRequest(BaseModel):
    # Required when the account already has a password.
    current_password: str | None = Field(default=None, max_length=PASSWORD_MAX_LENGTH)
    # Length is validated by the policy so the client gets a stable error code.
    new_password: str = Field(..., max_length=PASSWORD_MAX_LENGTH * 4)


class PasswordStatusResponse(BaseModel):
    has_password: bool
    password_updated_at: datetime | None = None


@router.put("/password", response_model=PasswordStatusResponse)
async def set_password(
    data: PasswordSetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PasswordStatusResponse:
    """Set, or change, the optional login password.

    Changing an existing password requires the current one (a stolen session
    alone cannot take over the password). Forgotten passwords are recovered
    by logging in with a magic link and removing/setting it here.
    Error details are stable codes: current_password_required,
    current_password_invalid, password_too_short, password_too_long,
    password_too_common, password_matches_identity.
    """
    await rate_limit_by_user(current_user.id, "password_set", 10, 900)

    if current_user.password_hash:
        if not data.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="current_password_required"
            )
        if not await verify_password_async(current_user.password_hash, data.current_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="current_password_invalid"
            )

    try:
        validate_new_password(
            data.new_password,
            identities=(current_user.email, current_user.username, current_user.display_name),
        )
    except PasswordPolicyError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.code
        ) from None

    current_user.password_hash = await hash_password_async(data.new_password)
    current_user.password_updated_at = datetime.now(UTC)
    await db.commit()
    return PasswordStatusResponse(
        has_password=True, password_updated_at=current_user.password_updated_at
    )


@router.delete("/password", status_code=status.HTTP_204_NO_CONTENT)
async def remove_password(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Remove the password: back to magic-link-only login (idempotent)."""
    if current_user.password_hash is not None:
        current_user.password_hash = None
        current_user.password_updated_at = datetime.now(UTC)
        await db.commit()


@router.post("/onboarding/complete", response_model=OnboardingCompleteResponse)
async def complete_onboarding(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OnboardingCompleteResponse:
    user_service = UserService(db)
    await user_service.complete_onboarding(current_user)
    await db.commit()

    return OnboardingCompleteResponse(onboarding_completed=True)
