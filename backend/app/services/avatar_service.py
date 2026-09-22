"""Profile photos (avatars).

Uploads are decoded, EXIF-orientation applied, cropped to a square (the crop
comes from the client's circle-crop UI, in pixels of the upright image; without
one we take the centred square) and re-encoded from raw pixels to WebP, so no
EXIF/GPS/XMP metadata ever survives. Two files are written next to the user's
garment photos (``STORAGE_PATH/<user_id>/``), which means the existing image
route serves them and account deletion (which removes that directory) cleans
them up.

URLs are signed with an expiry bucketed to the hour so the ``<img src>`` stays
the same across refetches and the browser cache keeps working.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from app.config import get_settings
from app.models.user import User
from app.utils.signed_urls import sign_image_url_cached

logger = logging.getLogger(__name__)

AVATAR_SIZE = 512
AVATAR_THUMB_SIZE = 128
MAX_AVATAR_BYTES = 10 * 1024 * 1024
ALLOWED_AVATAR_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
# Decoded format must match too: the declared content type is not trusted.
_ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "HEIF", "HEIC"}
# Guard against decompression bombs well below Pillow's default ceiling.
_MAX_PIXELS = 60_000_000


class AvatarError(ValueError):
    """Invalid upload; ``code`` is a stable API error detail."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CropBox:
    x: float
    y: float
    size: float


def _open(data: bytes) -> Image.Image:
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:  # pragma: no cover - dependency is in requirements.txt
        pass
    try:
        image = Image.open(BytesIO(data))
        if image.format not in _ALLOWED_FORMATS:
            raise AvatarError("unsupported_image_type")
        if image.width * image.height > _MAX_PIXELS:
            raise AvatarError("image_too_large")
        image.load()
    except AvatarError:
        raise
    except Exception as exc:
        raise AvatarError("invalid_image") from exc
    return image


def _square_box(width: int, height: int, crop: CropBox | None) -> tuple[int, int, int, int]:
    if crop is None or crop.size <= 0:
        side = min(width, height)
        left = (width - side) // 2
        top = (height - side) // 2
        return left, top, left + side, top + side
    side = int(round(min(crop.size, width, height)))
    side = max(side, 1)
    left = int(round(min(max(crop.x, 0), width - side)))
    top = int(round(min(max(crop.y, 0), height - side)))
    return left, top, left + side, top + side


def _flatten_rgb(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA", "P", "PA"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _encode_webp(image: Image.Image, size: int, quality: int) -> bytes:
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    # Copy the raw pixels into a fresh image: nothing from the source's info
    # dict (exif, xmp, icc, comments) can reach the encoder.
    clean = Image.frombytes("RGB", resized.size, resized.tobytes())
    out = BytesIO()
    clean.save(out, format="WEBP", quality=quality, method=6)
    return out.getvalue()


def render_avatar(data: bytes, crop: CropBox | None = None) -> tuple[bytes, bytes]:
    """Return ``(full_webp, thumb_webp)`` for an uploaded image."""
    if len(data) > MAX_AVATAR_BYTES:
        raise AvatarError("image_too_large")
    image = _open(data)
    if getattr(image, "n_frames", 1) > 1:
        image.seek(0)
    image = ImageOps.exif_transpose(image)
    image = _flatten_rgb(image)
    image = image.crop(_square_box(image.width, image.height, crop))
    size = min(AVATAR_SIZE, image.width)
    thumb = min(AVATAR_THUMB_SIZE, image.width)
    return _encode_webp(image, size, 88), _encode_webp(image, thumb, 85)


def _storage() -> Path:
    return Path(get_settings().storage_path)


def store_avatar(user_id: uuid.UUID, full: bytes, thumb: bytes) -> tuple[str, str]:
    """Write both files; returns their paths relative to STORAGE_PATH."""
    folder = _storage() / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    full_name = f"avatar_{token}.webp"
    thumb_name = f"avatar_{token}_thumb.webp"
    (folder / full_name).write_bytes(full)
    (folder / thumb_name).write_bytes(thumb)
    return f"{user_id}/{full_name}", f"{user_id}/{thumb_name}"


def delete_avatar_files(*paths: str | None) -> None:
    base = _storage().resolve()
    for rel in paths:
        if not rel:
            continue
        target = (base / rel).resolve()
        if not target.is_relative_to(base):
            continue
        try:
            target.unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not delete avatar file %s", rel, exc_info=True)


def avatar_url(user: User | None) -> str | None:
    """Full-size (512px) avatar URL: the uploaded photo, else the provider picture."""
    if user is None:
        return None
    if user.avatar_path:
        return sign_image_url_cached(user.avatar_path)
    return user.avatar_url


def avatar_thumb_url(user: User | None) -> str | None:
    """Small (128px) avatar URL for lists; falls back like ``avatar_url``."""
    if user is None:
        return None
    if user.avatar_thumb_path:
        return sign_image_url_cached(user.avatar_thumb_path)
    return avatar_url(user)
