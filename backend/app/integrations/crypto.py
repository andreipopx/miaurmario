"""Symmetric encryption for third-party OAuth tokens (Pinterest, Spotify).

Tokens are stored ciphered at rest with Fernet (AES-128-CBC + HMAC-SHA256).
The key comes from INTEGRATIONS_TOKEN_ENCRYPTION_KEY (falling back to the
legacy PINTEREST_TOKEN_ENCRYPTION_KEY) and must be a url-safe base64-encoded
32-byte value; generate with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
Rotating the key invalidates every stored token (users simply re-connect).
"""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class IntegrationCryptoError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = get_settings().token_encryption_key
    if not key:
        raise IntegrationCryptoError(
            "INTEGRATIONS_TOKEN_ENCRYPTION_KEY not configured; cannot cipher tokens"
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise IntegrationCryptoError(f"Invalid Fernet key: {exc}") from exc


def encryption_configured() -> bool:
    try:
        _fernet()
    except IntegrationCryptoError:
        return False
    return True


def encrypt_token(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())


def decrypt_token(ciphertext: bytes) -> str:
    try:
        return _fernet().decrypt(ciphertext).decode()
    except InvalidToken as exc:
        raise IntegrationCryptoError("Token could not be decrypted (key rotated?)") from exc
