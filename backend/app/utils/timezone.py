from datetime import UTC, date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models import User

# Browsers (ICU/CLDR) still report some pre-2022 IANA names, e.g. Chrome's
# Intl.DateTimeFormat().resolvedOptions().timeZone gives "Asia/Calcutta". Debian
# ships those in the separate tzdata-legacy package, which our slim image lacks,
# so map them to the current names before touching zoneinfo.
LEGACY_TIMEZONE_ALIASES: dict[str, str] = {
    "Africa/Asmera": "Africa/Asmara",
    "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "America/Catamarca": "America/Argentina/Catamarca",
    "America/Cordoba": "America/Argentina/Cordoba",
    "America/Godthab": "America/Nuuk",
    "America/Indianapolis": "America/Indiana/Indianapolis",
    "America/Jujuy": "America/Argentina/Jujuy",
    "America/Louisville": "America/Kentucky/Louisville",
    "America/Mendoza": "America/Argentina/Mendoza",
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "Europe/Kiev": "Europe/Kyiv",
    "Pacific/Enderbury": "Pacific/Kanton",
    "Pacific/Ponape": "Pacific/Pohnpei",
    "Pacific/Truk": "Pacific/Chuuk",
}


def canonical_timezone(name: str) -> str:
    return LEGACY_TIMEZONE_ALIASES.get(name, name)


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
        return ZoneInfo(canonical_timezone(user.timezone or "UTC"))
    except Exception:
        return ZoneInfo("UTC")


def get_user_today(user: User) -> date:
    user_tz = get_user_timezone(user)
    return datetime.now(UTC).astimezone(user_tz).date()


def get_user_now(user: User) -> datetime:
    user_tz = get_user_timezone(user)
    return datetime.now(UTC).astimezone(user_tz)
