"""Where the user is: a city-level location and a timezone, both detected.

This module owns the privacy contract for detected locations, so the rules live
in one place and are unit-tested:

- **The exact position never survives.** Everything rounds to
  :data:`CITY_COORD_DECIMALS` (2 decimals, ~1 km — the city, not the street)
  *before* any outbound request, any log line and any database write. Neither
  the geocoding provider, nor our logs, nor the ``users`` row ever sees a
  precise fix.
- **Only the city and the zone are kept**: ``location_name`` ("Madrid,
  Comunidad de Madrid, España"), the rounded coordinates the weather needs, and
  the IANA timezone the notification hour needs.
- **A manual timezone is never overwritten.** ``users.timezone_source`` is
  ``"manual"`` once the user picks a zone by hand, and detection skips those
  rows for good.
- **Travelling never changes anything silently.** More than
  :data:`TRAVEL_DISTANCE_KM` from the saved city, we ask; we never move the
  city on our own, and we ask at most once every
  :data:`TRAVEL_PROMPT_INTERVAL`.
"""

from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from math import asin, cos, radians, sin, sqrt

from app.services.geocoding_service import Place

# 2 decimals ≈ 1.1 km of latitude: enough to name a city and pull its weather,
# not enough to place someone in a street.
CITY_COORD_DECIMALS = 2
_CITY_QUANTUM = Decimal(1).scaleb(-CITY_COORD_DECIMALS)

# Far enough that the weather is a different weather, and near enough that
# commuting inside a metropolitan area never triggers the question.
TRAVEL_DISTANCE_KM = 100.0

# "¿Estás en Lisboa?" is asked at most once a day.
TRAVEL_PROMPT_INTERVAL = timedelta(days=1)

# Mean Earth radius (IUGG), km.
EARTH_RADIUS_KM = 6371.0088

TIMEZONE_SOURCE_AUTO = "auto"
TIMEZONE_SOURCE_MANUAL = "manual"

# users.location_name is VARCHAR(100).
LOCATION_NAME_MAX = 100


def round_city_coord(value: float | Decimal) -> Decimal:
    """Round one coordinate down to city precision (2 decimals).

    Half-up so the result does not depend on the value's parity, which keeps
    the rounding predictable in tests and in the Redis cache key.
    """
    return Decimal(str(value)).quantize(_CITY_QUANTUM, rounding=ROUND_HALF_UP)


def round_city_coords(
    latitude: float | Decimal, longitude: float | Decimal
) -> tuple[Decimal, Decimal]:
    """The only doorway a device position walks through before it is used."""
    return round_city_coord(latitude), round_city_coord(longitude)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in km."""
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = radians(lon2 - lon1)
    h = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(h)))


def distance_from_saved_km(
    saved_lat: Decimal | float | None,
    saved_lon: Decimal | float | None,
    latitude: float | Decimal,
    longitude: float | Decimal,
) -> float | None:
    """Distance to the saved city, or None when there is no city on file."""
    if saved_lat is None or saved_lon is None:
        return None
    return haversine_km(float(saved_lat), float(saved_lon), float(latitude), float(longitude))


def is_travelling(distance_km: float | None) -> bool:
    """True when a reading is far enough from the saved city to be worth asking about."""
    return distance_km is not None and distance_km > TRAVEL_DISTANCE_KM


def travel_prompt_allowed(last_prompt_at: datetime | None, now: datetime) -> bool:
    """At most one "¿Estás en Lisboa?" per day, counted from the last ask."""
    if last_prompt_at is None:
        return True
    return now - last_prompt_at >= TRAVEL_PROMPT_INTERVAL


def city_label(place: Place) -> str:
    """What we store as ``location_name``: the city and its region/country."""
    return place.label[:LOCATION_NAME_MAX]


def city_name(place: Place) -> str:
    """Just the city, for "¿Estás en Lisboa?"."""
    return place.name[:LOCATION_NAME_MAX]


def short_city_name(location_name: str | None) -> str | None:
    """The city alone out of a stored "Madrid, Comunidad de Madrid, España"."""
    if not location_name:
        return None
    return location_name.split(",")[0].strip() or None
