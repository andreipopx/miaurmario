from datetime import UTC, date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models import User


@lru_cache(maxsize=1024)
def is_valid_timezone(name: str) -> bool:
    """True for any IANA zone name zoneinfo can load (e.g. "Europe/Madrid", "UTC")."""
    if not name or len(name) > 50 or name.startswith(("/", ".")) or ".." in name:
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return False
    return True


def get_user_timezone(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def get_user_today(user: User) -> date:
    user_tz = get_user_timezone(user)
    return datetime.now(UTC).astimezone(user_tz).date()


def get_user_now(user: User) -> datetime:
    user_tz = get_user_timezone(user)
    return datetime.now(UTC).astimezone(user_tz)
