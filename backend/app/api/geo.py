"""City search + reverse geocoding for the location picker (settings, onboarding)."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.models.user import User
from app.services.geocoding_service import (
    MAX_QUERY_LENGTH,
    GeocodingBusyError,
    GeocodingError,
    Place,
    reverse_geocode,
    search_places,
)
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/geo", tags=["Geo"])

# Autocomplete fires on (debounced) keystrokes; reverse is one tap.
SEARCH_RATE_LIMIT = (60, 60)
REVERSE_RATE_LIMIT = (10, 60)


class PlaceResponse(BaseModel):
    name: str
    admin1: str | None = None
    country: str | None = None
    country_code: str | None = None
    latitude: float
    longitude: float
    timezone: str | None = None
    label: str

    @classmethod
    def from_place(cls, place: Place) -> "PlaceResponse":
        return cls(**place.to_dict())


class PlaceSearchResponse(BaseModel):
    results: list[PlaceResponse]


@router.get("/search", response_model=PlaceSearchResponse)
async def search(
    current_user: Annotated[User, Depends(get_current_user)],
    q: str = Query(..., min_length=1, max_length=MAX_QUERY_LENGTH),
    lang: Literal["es", "en"] = "es",
) -> PlaceSearchResponse:
    await rate_limit_by_user(current_user.id, "geo_search", *SEARCH_RATE_LIMIT)
    try:
        places = await search_places(q, lang)
    except GeocodingError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="geocoding_unavailable",
        ) from None
    return PlaceSearchResponse(results=[PlaceResponse.from_place(p) for p in places])


@router.get("/reverse", response_model=PlaceResponse)
async def reverse(
    current_user: Annotated[User, Depends(get_current_user)],
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    lang: Literal["es", "en"] = "es",
) -> PlaceResponse:
    await rate_limit_by_user(current_user.id, "geo_reverse", *REVERSE_RATE_LIMIT)
    try:
        place = await reverse_geocode(lat, lon, lang)
    except GeocodingBusyError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="geocoding_busy",
        ) from None
    except GeocodingError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="geocoding_unavailable",
        ) from None
    if place is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="place_not_found")
    return PlaceResponse.from_place(place)
