"""Symmetric encryption for Pinterest OAuth tokens.

Tokens are stored ciphered at rest with Fernet (AES-128-CBC + HMAC-SHA256).
The key must be a url-safe base64-encoded 32-byte value; generate with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class PinterestCryptoError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = get_settings().pinterest_token_encryption_key
    if not key:
        raise PinterestCryptoError(
            "pinterest_token_encryption_key not configured; cannot cipher tokens"
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise PinterestCryptoError(f"Invalid Fernet key: {exc}") from exc


def encrypt_token(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())


def decrypt_token(ciphertext: bytes) -> str:
    try:
        return _fernet().decrypt(ciphertext).decode()
    except InvalidToken as exc:
        raise PinterestCryptoError("Token could not be decrypted (key rotated?)") from exc
