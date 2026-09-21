"""Optional password login: argon2id hashing and a small strength policy.

argon2-cffi's PasswordHasher defaults (argon2id, RFC 9106 "low memory" profile)
are used as-is. Unlike bcrypt there is no 72-byte truncation, so the full
password always counts. Hashing is CPU/memory heavy on purpose; call the async
wrappers from request handlers so the event loop is not blocked.
"""

import asyncio
import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 128

_hasher = PasswordHasher()

# Most common passwords (RockYou / NordPass / SplashData top lists) that are at
# least PASSWORD_MIN_LENGTH long or become so with a trailing number, plus
# obvious Spanish and app-specific picks. Compared case-insensitively, both
# verbatim and with trailing digits/symbols stripped ("password2024!").
_COMMON_PASSWORDS = frozenset(
    {
        "password",
        "passw0rd",
        "password1",
        "password12",
        "password123",
        "password1234",
        "passwordpassword",
        "123456789",
        "1234567890",
        "12345678910",
        "0123456789",
        "9876543210",
        "0987654321",
        "1111111111",
        "0000000000",
        "1212121212",
        "1234512345",
        "1122334455",
        "qwerty",
        "qwerty123",
        "qwertyuiop",
        "qwertyuiop123",
        "qwerty12345",
        "qwertyqwerty",
        "asdfghjkl",
        "asdfghjkl123",
        "zxcvbnm",
        "zxcvbnm123",
        "1q2w3e4r5t",
        "1q2w3e4r5t6y",
        "q1w2e3r4t5",
        "1qaz2wsx3edc",
        "qazwsxedc",
        "qazwsxedcrfv",
        "abcdefghij",
        "abcdefg123",
        "abc1234567",
        "abcd123456",
        "a123456789",
        "iloveyou",
        "iloveyou123",
        "letmein",
        "letmein123",
        "welcome",
        "welcome123",
        "admin",
        "admin12345",
        "administrator",
        "princess",
        "sunshine",
        "football",
        "baseball",
        "basketball",
        "superman",
        "batman",
        "starwars",
        "pokemon",
        "whatever",
        "trustno1",
        "monkey",
        "dragon",
        "master",
        "shadow",
        "michael",
        "jennifer",
        "charlie",
        "freedom",
        "computer",
        "internet",
        "changeme",
        "changeme123",
        "secret",
        "secret123",
        "default",
        "loveyou",
        "lovely",
        "chocolate",
        "butterfly",
        "liverpool",
        "manchester",
        "barcelona",
        "realmadrid",
        "madrid",
        "spain",
        "espana",
        "españa",
        "contraseña",
        "contrasena",
        "contraseña123",
        "micontraseña",
        "clave",
        "clave123",
        "teamo",
        "teamomucho",
        "tequiero",
        "hola",
        "hola1234",
        "holahola",
        "bienvenido",
        "futbol",
        "mariposa",
        "princesa",
        "estrella",
        "tqm",
        "amor",
        "amormio",
        "miamor",
        "gatito",
        "michi",
        "miau",
        "miaumiau",
        "miaurmario",
        "stinky",
        "armario",
        "wardrobe",
        "wardrowbe",
    }
)

_TRAILING_NOISE = re.compile(r"[\d\W_]+$")


class PasswordPolicyError(ValueError):
    """Raised with a stable machine-readable code as the message."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _is_sequence(value: str) -> bool:
    """True for runs like 'abcdefghij', '9876543210' or a repeated short block."""
    if len(value) < 2:
        return True
    steps = {ord(b) - ord(a) for a, b in zip(value, value[1:], strict=False)}
    if len(steps) == 1 and steps.pop() in (-1, 0, 1):
        return True
    for size in range(1, len(value) // 2 + 1):
        block = value[:size]
        if block * (len(value) // size) + block[: len(value) % size] == value:
            return True
    return False


def validate_new_password(password: str, *, identities: tuple[str | None, ...] = ()) -> None:
    """Enforce the password policy; raises PasswordPolicyError(code)."""
    if len(password) < PASSWORD_MIN_LENGTH:
        raise PasswordPolicyError("password_too_short")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise PasswordPolicyError("password_too_long")

    lowered = password.lower()
    stripped = _TRAILING_NOISE.sub("", lowered)
    if (
        lowered in _COMMON_PASSWORDS
        or stripped in _COMMON_PASSWORDS
        or len(set(lowered)) < 4
        or _is_sequence(lowered)
    ):
        raise PasswordPolicyError("password_too_common")

    for identity in identities:
        if not identity:
            continue
        ident = identity.lower().strip()
        local = ident.split("@", 1)[0]
        for candidate in {ident, local}:
            if len(candidate) >= 3 and (
                lowered == candidate
                or (
                    lowered.startswith(candidate)
                    and _TRAILING_NOISE.fullmatch(lowered[len(candidate) :])
                )
            ):
                raise PasswordPolicyError("password_matches_identity")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# Computed once at import so even the first unknown-user attempt costs exactly
# one verification (no extra hash on a cold cache).
_DUMMY_HASH = _hasher.hash("miaurmario-dummy-password-for-timing")


def burn_verification(password: str) -> None:
    """Spend the same work as a real verification (unknown user / no password),
    so response timing does not reveal whether an account exists."""
    verify_password(_DUMMY_HASH, password)


async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        await asyncio.to_thread(burn_verification, password)
        return False
    return await asyncio.to_thread(verify_password, password_hash, password)
