import hashlib
import hmac
import time

from app.config import get_settings

DEFAULT_EXPIRY_SECONDS = 3600


def _get_image_signing_key() -> bytes:
    settings = get_settings()
    return hmac.new(settings.secret_key.encode(), b"image-url-signing", hashlib.sha256).digest()


def sign_image_url(path: str, expiry_seconds: int = DEFAULT_EXPIRY_SECONDS) -> str:
    return _signed_path(path, int(time.time()) + expiry_seconds)


def sign_image_url_cached(path: str, bucket_seconds: int = DEFAULT_EXPIRY_SECONDS) -> str:
    """Like ``sign_image_url`` but stable within a time bucket (browser-cacheable).

    The expiry is rounded up to the end of the next bucket, so the URL is valid
    for between one and two buckets and identical for every request in between.
    """
    expires = (int(time.time()) // bucket_seconds + 2) * bucket_seconds
    return _signed_path(path, expires)


def _signed_path(path: str, expires: int) -> str:
    message = f"{path}:{expires}"
    signature = hmac.new(_get_image_signing_key(), message.encode(), hashlib.sha256).hexdigest()[
        :32
    ]
    return f"/api/v1/images/{path}?expires={expires}&sig={signature}"


def verify_signature(path: str, expires: str, signature: str) -> bool:
    try:
        expiry_time = int(expires)
        if time.time() > expiry_time:
            return False
    except (ValueError, TypeError):
        return False

    message = f"{path}:{expires}"
    expected_signature = hmac.new(
        _get_image_signing_key(), message.encode(), hashlib.sha256
    ).hexdigest()[:32]

    return hmac.compare_digest(signature, expected_signature)
