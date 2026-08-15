import re
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.user_service import UserService
from app.utils.auth import get_current_user

USERNAME_REGEX = re.compile(r"^[a-z0-9_]{3,20}$")

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
    timezone: str
    location_lat: float | None = None
    location_lon: float | None = None
    location_name: str | None = None
    family_id: str | None = None
    role: str
    onboarding_completed: bool
    body_measurements: dict | None = None


class UserProfileUpdate(BaseModel):
    display_name: str | None = None
    username: str | None = Field(default=None, min_length=3, max_length=20)
    bio: str | None = Field(default=None, max_length=280)
    timezone: str | None = None
    location_lat: Decimal | None = None
    location_lon: Decimal | None = None
    location_name: str | None = None
    body_measurements: dict | None = None


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

    for field, value in update_data.items():
        setattr(current_user, field, value)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="username_taken"
        ) from None
    await db.refresh(current_user)
    await db.commit()

    return _user_response(current_user)


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
        avatar_url=user.avatar_url,
        timezone=user.timezone,
        location_lat=float(user.location_lat) if user.location_lat else None,
        location_lon=float(user.location_lon) if user.location_lon else None,
        location_name=user.location_name,
        family_id=str(user.family_id) if user.family_id else None,
        role=user.role,
        onboarding_completed=user.onboarding_completed,
        body_measurements=user.body_measurements,
    )


@router.post("/onboarding/complete", response_model=OnboardingCompleteResponse)
async def complete_onboarding(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OnboardingCompleteResponse:
    user_service = UserService(db)
    await user_service.complete_onboarding(current_user)
    await db.commit()

    return OnboardingCompleteResponse(onboarding_completed=True)
