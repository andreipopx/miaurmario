"""Garments from a screenshot: a shop's product page, an outfit on Instagram, a grid.

The fastest way to add something bought online is the screenshot people already
take. One vision call lists the garments with what is written next to them (name,
brand, price) and where each one is; then, for the shops that publish their
catalogue (the Inditex brands), the name is looked up there so the garment
arrives with the shop's own photos — the one without the model first — instead
of a crop of the screen.

Like the selfie, the screenshot is only ever held in memory: decoded, re-encoded
without metadata, sent to the model, cropped, and dropped when the request ends.
What reaches the user is the crop (or the shop's photo) they then choose to save.
"""

from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, field
from decimal import Decimal

from PIL import Image, ImageOps

from app.services.link_import import _currency_from, parse_price
from app.services.selfie_outfit import (
    MAX_UPLOAD_BYTES,
    DetectedGarment,
    SelfieImageError,
    _extract_json,
    parse_detections,
)
from app.services.shop_catalog import _title

logger = logging.getLogger(__name__)

MAX_GARMENTS = 8
#: Long edge the model reads: phone screenshots are tall, and the product name
#: has to stay legible.
MODEL_EDGE = 1280
#: Long edge kept for crops.
CROP_SOURCE_EDGE = 2000
CROP_EDGE = 1200
#: Margin added around the model's box, as a share of the box.
CROP_MARGIN = 0.08
#: A box smaller than this share of the screenshot is grown to it.
MIN_CROP_SHARE = 0.12


class ScreenshotImageError(SelfieImageError):
    """The upload is not a usable image."""


@dataclass
class ScreenshotGarment:
    garment: DetectedGarment
    name: str | None = None
    brand: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    #: (x0, y0, x1, y1) in thousandths, already validated; None = whole image.
    box: tuple[int, int, int, int] | None = None
    extras: dict = field(default_factory=dict)


@dataclass
class PreparedScreenshot:
    """The screenshot, upright and stripped: one copy for the model, one to crop."""

    model_jpeg: bytes
    source: Image.Image


def prepare(image_data: bytes) -> PreparedScreenshot:
    if not image_data:
        raise ScreenshotImageError("empty upload")
    if len(image_data) > MAX_UPLOAD_BYTES:
        raise ScreenshotImageError("image too large")
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:  # pragma: no cover - optional dependency
        pass
    try:
        with Image.open(io.BytesIO(image_data)) as img:
            img = ImageOps.exif_transpose(img)
            source = img.convert("RGB")
    except Exception as e:  # PIL raises a zoo of errors for broken files
        raise ScreenshotImageError(f"unreadable image: {type(e).__name__}") from None
    source.thumbnail((CROP_SOURCE_EDGE, CROP_SOURCE_EDGE), Image.Resampling.LANCZOS)
    model = source.copy()
    model.thumbnail((MODEL_EDGE, MODEL_EDGE), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    model.save(buffer, format="JPEG", quality=85)
    return PreparedScreenshot(model_jpeg=buffer.getvalue(), source=source)


def _box(value: object) -> tuple[int, int, int, int] | None:
    if not isinstance(value, list | tuple) or len(value) != 4:
        return None
    try:
        x0, y0, x1, y1 = (max(0, min(1000, round(float(v)))) for v in value)
    except (TypeError, ValueError):
        return None
    if x1 - x0 < 10 or y1 - y0 < 10:
        return None
    return (x0, y0, x1, y1)


def _text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def parse_screenshot(response_text: str) -> list[ScreenshotGarment]:
    """The model's answer, validated garment by garment with the selfie contract;
    the written name, brand, price and the box ride along when they make sense."""
    data = _extract_json(response_text)
    raw_items = (data or {}).get("garments")
    if not isinstance(raw_items, list):
        raw_items = [data] if data and data.get("type") else []

    out: list[ScreenshotGarment] = []
    for raw in raw_items[: MAX_GARMENTS * 2]:
        if not isinstance(raw, dict):
            continue
        parsed = parse_detections(json.dumps({"garments": [raw]}))
        if not parsed:
            continue
        price_text = _text(raw.get("price"), 40)
        out.append(
            ScreenshotGarment(
                garment=parsed[0],
                name=_title(_text(raw.get("name"), 200)),
                brand=_title(_text(raw.get("brand"), 60)),
                price=parse_price(price_text) if price_text else None,
                currency=_currency_from(price_text) if price_text else None,
                box=_box(raw.get("box")),
            )
        )
        if len(out) >= MAX_GARMENTS:
            break
    return out


def crop(source: Image.Image, box: tuple[int, int, int, int] | None) -> bytes:
    """The garment's part of the screenshot as a JPEG, with a little air around it.

    Models draw boxes a bit tight, so a margin is added; a tiny box (a belt) is
    grown to a usable size around its centre. No box: the whole screenshot.
    """
    width, height = source.size
    if box is None:
        region = (0, 0, width, height)
    else:
        x0, y0, x1, y1 = (
            box[0] * width / 1000,
            box[1] * height / 1000,
            box[2] * width / 1000,
            box[3] * height / 1000,
        )
        bw, bh = x1 - x0, y1 - y0
        x0, x1 = x0 - bw * CROP_MARGIN, x1 + bw * CROP_MARGIN
        y0, y1 = y0 - bh * CROP_MARGIN, y1 + bh * CROP_MARGIN
        min_w, min_h = width * MIN_CROP_SHARE, height * MIN_CROP_SHARE
        if x1 - x0 < min_w:
            cx = (x0 + x1) / 2
            x0, x1 = cx - min_w / 2, cx + min_w / 2
        if y1 - y0 < min_h:
            cy = (y0 + y1) / 2
            y0, y1 = cy - min_h / 2, cy + min_h / 2
        region = (
            max(0, round(x0)),
            max(0, round(y0)),
            min(width, round(x1)),
            min(height, round(y1)),
        )
    piece = source.crop(region)
    piece.thumbnail((CROP_EDGE, CROP_EDGE), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    piece.save(buffer, format="JPEG", quality=86)
    return buffer.getvalue()
