"""Detected location and timezone: the button, the travel prompt, the delete.

Three things the user never has to type:

``POST /users/me/location/device``
    A geolocation reading from the browser, turned into a city. The exact
    position is rounded to city precision before anything is sent upstream or
    written (see :mod:`app.services.location_service`). ``trigger`` says who
    asked, and that decides what may change:

    ``button``
        The user tapped "Usar mi ubicación". Saves the city — unless it is more
        than 100 km from the city on file, in which case nothing changes and we
        answer ``travel_suspected`` so the UI can ask.
    ``open``
        A silent check when the app opens, on a permission the browser already
        granted. Never saves anything: it only reports a suspected trip, at
        most once a day.
    ``confirm``
        "Sí, actualízalo" on that prompt. Saves.

``DELETE /users/me/location``
    "Borrar mi ubicación". Drops the city and its coordinates; keeps the
    timezone, which notifications still need.

``POST /users/me/timezone/auto``
    The browser's zone, saved silently on first load — but never over a zone the
    user picked by hand.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.geocoding_service import (
    GeocodingBusyError,
    GeocodingError,
    Place,
    reverse_geocode,
)
from app.services.location_service import (
    TIMEZONE_SOURCE_AUTO,
    TIMEZONE_SOURCE_MANUAL,
    city_label,
    city_name,
    distance_from_saved_km,
    is_travelling,
    round_city_coords,
    short_city_name,
    travel_prompt_allowed,
)
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user
from app.utils.timezone import canonical_timezone, is_valid_timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users/me", tags=["Location"])

# One tap each time, plus the once-per-open check: generous but bounded, and the
# reverse geocoder behind it has its own 1 req/s app-wide throttle.
DEVICE_RATE_LIMIT = (20, 300)


class DeviceLocationRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    lang: Literal["es", "en"] = "es"
    trigger: Literal["button", "open", "confirm"] = "button"


class DetectedPlace(BaseModel):
    """A city, at city precision. Never the device's own coordinates."""

    name: str
    label: str
    latitude: float
    longitude: float
    timezone: str | None = None


class DeviceLocationResponse(BaseModel):
    status: Literal["saved", "travel_suspected", "unchanged"]
    detected: DetectedPlace | None = None
    # The city still on file, for "No, sigue con Madrid".
    current_city: str | None = None
    distance_km: int | None = None
    # The zone in effect after this call, so the UI can show it without a refetch.
    timezone: str | None = None
    timezone_source: str | None = None


class LocationStatusResponse(BaseModel):
    location_name: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    timezone: str
    timezone_source: str


class AutoTimezoneRequest(BaseModel):
    timezone: str = Field(..., max_length=50)

    @field_validator("timezone")
    @classmethod
    def _valid_timezone(cls, value: str) -> str:
        value = canonical_timezone(value.strip())
        if not is_valid_timezone(value):
            raise ValueError("invalid_timezone")
        return value


class AutoTimezoneResponse(BaseModel):
    timezone: str
    timezone_source: str
    # False when the user had already chosen a zone by hand, or it already matched.
    updated: bool


def _apply_timezone_from_city(user: User, place: Place) -> None:
    """Take the city's zone, unless the user picked one by hand."""
    if user.timezone_source == TIMEZONE_SOURCE_MANUAL:
        return
    if not place.timezone:
        return
    zone = canonical_timezone(place.timezone)
    if not is_valid_timezone(zone):
        return
    user.timezone = zone
    user.timezone_source = TIMEZONE_SOURCE_AUTO


def _save_city(user: User, latitude, longitude, place: Place) -> None:
    user.location_lat = latitude
    user.location_lon = longitude
    user.location_name = city_label(place)
    _apply_timezone_from_city(user, place)
    # We are now where they are; the travel question starts over.
    user.travel_prompt_at = None


def _status(user: User) -> LocationStatusResponse:
    return LocationStatusResponse(
        location_name=user.location_name,
        location_lat=float(user.location_lat) if user.location_lat is not None else None,
        location_lon=float(user.location_lon) if user.location_lon is not None else None,
        timezone=user.timezone,
        timezone_source=user.timezone_source,
    )


@router.post("/location/device", response_model=DeviceLocationResponse)
async def use_device_location(
    data: DeviceLocationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DeviceLocationResponse:
    """Turn a browser geolocation reading into a city (see the module docstring).

    Error details: ``geocoding_busy``, ``geocoding_unavailable`` (both 503),
    ``place_not_found`` (404). The caller keeps manual entry available for all
    three: nothing here is required for the app to work.
    """
    await rate_limit_by_user(current_user.id, "location_device", *DEVICE_RATE_LIMIT)

    # First thing, before any outbound call or write: forget the exact position.
    lat, lon = round_city_coords(data.latitude, data.longitude)

    try:
        place = await reverse_geocode(float(lat), float(lon), data.lang)
    except GeocodingBusyError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="geocoding_busy"
        ) from None
    except GeocodingError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="geocoding_unavailable"
        ) from None
    if place is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="place_not_found")

    detected = DetectedPlace(
        name=city_name(place),
        label=city_label(place),
        latitude=float(lat),
        longitude=float(lon),
        timezone=place.timezone,
    )
    distance = distance_from_saved_km(
        current_user.location_lat, current_user.location_lon, lat, lon
    )
    far_away = is_travelling(distance)
    now = datetime.now(UTC)

    def answer(state: Literal["saved", "travel_suspected", "unchanged"]) -> DeviceLocationResponse:
        return DeviceLocationResponse(
            status=state,
            detected=detected,
            current_city=short_city_name(current_user.location_name),
            distance_km=round(distance) if distance is not None else None,
            timezone=current_user.timezone,
            timezone_source=current_user.timezone_source,
        )

    # "Sí, actualízalo": the question has been answered, so move the city.
    if data.trigger == "confirm":
        _save_city(current_user, lat, lon, place)
        await db.commit()
        return answer("saved")

    if far_away:
        # Never a silent move, however we got here: ask instead — and the silent
        # check asks at most once a day.
        if data.trigger == "open" and not travel_prompt_allowed(current_user.travel_prompt_at, now):
            return answer("unchanged")
        current_user.travel_prompt_at = now
        await db.commit()
        return answer("travel_suspected")

    # Near the city on file, or no city yet. The city only ever changes on a tap,
    # so the silent check stops here.
    if data.trigger == "open":
        return answer("unchanged")

    _save_city(current_user, lat, lon, place)
    await db.commit()
    return answer("saved")


@router.delete("/location", response_model=LocationStatusResponse)
async def delete_location(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> LocationStatusResponse:
    """ "Borrar mi ubicación": forget the city, keep the hour.

    Weather-dependent suggestions go back to working without weather, exactly as
    they do for someone who never set a location.
    """
    current_user.location_lat = None
    current_user.location_lon = None
    current_user.location_name = None
    current_user.travel_prompt_at = None
    await db.commit()
    return _status(current_user)


@router.post("/timezone/auto", response_model=AutoTimezoneResponse)
async def set_auto_timezone(
    data: AutoTimezoneRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> AutoTimezoneResponse:
    """Save the browser's zone, silently — never over a zone chosen by hand."""
    if current_user.timezone_source == TIMEZONE_SOURCE_MANUAL:
        return AutoTimezoneResponse(
            timezone=current_user.timezone,
            timezone_source=current_user.timezone_source,
            updated=False,
        )
    if current_user.timezone == data.timezone and (
        current_user.timezone_source == TIMEZONE_SOURCE_AUTO
    ):
        return AutoTimezoneResponse(
            timezone=current_user.timezone, timezone_source=TIMEZONE_SOURCE_AUTO, updated=False
        )

    current_user.timezone = data.timezone
    current_user.timezone_source = TIMEZONE_SOURCE_AUTO
    await db.commit()
    return AutoTimezoneResponse(
        timezone=current_user.timezone, timezone_source=TIMEZONE_SOURCE_AUTO, updated=True
    )
