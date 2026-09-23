"""Selfie -> "qué llevas puesto": read the garments off a full-body photo.

Three independent pieces, all pure enough to unit-test without a provider:

* ``sanitize_selfie`` turns the uploaded bytes into a base64 JPEG **in memory**.
  The photo is never written to disk and never stored: it is decoded, oriented
  with its EXIF, re-encoded without any metadata (so EXIF/GPS/device tags are
  gone) and handed to the vision model. Once the request ends the buffer is the
  only copy that ever existed, and it is dropped.
* ``parse_detections`` validates the model's JSON against the same vocabulary
  the tagging prompt uses (``app.services.ai_service``), dropping anything the
  model invented.
* ``match_garments`` scores every detection against the user's wardrobe. No
  embeddings: a small weighted score over type / colour / pattern / material,
  plus a greedy assignment so one wardrobe item is never claimed twice.

Nothing here comments on the person: the prompt forbids it and the parser only
keeps the garment fields of the contract, so any stray prose is discarded.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
from dataclasses import dataclass, field
from io import BytesIO
from uuid import UUID

from PIL import Image, ImageOps

from app.models.item import ClothingItem
from app.services.ai_service import (
    VALID_COLORS,
    VALID_MATERIALS,
    VALID_PATTERNS,
    VALID_TYPES,
)
from app.utils.clothing import ITEM_ROLE

logger = logging.getLogger(__name__)

# The vision model gets a 768px long edge: full-body shots need more detail than
# the 512px used for single-garment tagging, but the cost grows with the pixels.
MAX_SELFIE_EDGE = 768
JPEG_QUALITY = 82
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_GARMENTS = 8


class SelfieImageError(ValueError):
    """The upload is not a usable photo (bad format, too large, corrupt)."""


# --- Detection ----------------------------------------------------------------


@dataclass
class DetectedGarment:
    """One garment the model says it can see. Clothes only, never the wearer."""

    type: str
    subtype: str | None = None
    primary_color: str | None = None
    colors: list[str] = field(default_factory=list)
    pattern: str | None = None
    material: str | None = None


def _extract_json(text: str) -> dict | None:
    """Parse the model's answer: raw JSON, a ```json fence, or JSON in prose."""
    candidate = (text or "").strip()
    if not candidate:
        return None
    try:
        data = json.loads(candidate)
        return data if isinstance(data, dict) else {"garments": data}
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", candidate)
    if fenced:
        try:
            data = json.loads(fenced.group(1))
            return data if isinstance(data, dict) else {"garments": data}
        except json.JSONDecodeError:
            pass

    start = candidate.find("{")
    if start != -1:
        depth = 0
        for i, char in enumerate(candidate[start:], start):
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(candidate[start : i + 1])
                        return data if isinstance(data, dict) else None
                    except json.JSONDecodeError:
                        break

    start = candidate.find("[")
    if start != -1:
        end = candidate.rfind("]")
        if end > start:
            try:
                data = json.loads(candidate[start : end + 1])
                if isinstance(data, list):
                    return {"garments": data}
            except json.JSONDecodeError:
                pass
    return None


def _clean(value: object, allowed: set[str]) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower().replace("_", "-").replace(" ", "-")
    return normalized if normalized in allowed else None


def parse_detections(response_text: str) -> list[DetectedGarment]:
    """Validate the vision answer into garments; unknown values are dropped.

    A garment without a recognised ``type`` is useless for matching and is
    skipped, so a hallucinated or empty answer yields an empty list rather than
    garbage the user has to clean up.
    """
    data = _extract_json(response_text)
    if not data:
        return []

    raw_items = data.get("garments")
    if not isinstance(raw_items, list):
        # Some models answer with a single object instead of the wrapper.
        raw_items = [data] if data.get("type") else []

    garments: list[DetectedGarment] = []
    for raw in raw_items[: MAX_GARMENTS * 2]:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), VALID_TYPES)
        if not item_type:
            continue

        colors_raw = raw.get("colors")
        colors: list[str] = []
        if isinstance(colors_raw, list):
            for c in colors_raw[:3]:
                cleaned = _clean(c, VALID_COLORS)
                if cleaned and cleaned not in colors:
                    colors.append(cleaned)

        primary = _clean(raw.get("primary_color"), VALID_COLORS) or (colors[0] if colors else None)
        if primary and primary not in colors:
            colors.insert(0, primary)

        subtype = raw.get("subtype")
        subtype = (
            subtype.strip().lower()[:50] if isinstance(subtype, str) and subtype.strip() else None
        )

        garments.append(
            DetectedGarment(
                type=item_type,
                subtype=subtype,
                primary_color=primary,
                colors=colors,
                pattern=_clean(raw.get("pattern"), VALID_PATTERNS),
                material=_clean(raw.get("material"), VALID_MATERIALS),
            )
        )
        if len(garments) >= MAX_GARMENTS:
            break
    return garments


# --- Image handling -------------------------------------------------------------


def sanitize_selfie(image_data: bytes) -> str:
    """Return a base64 JPEG of the selfie, stripped of EXIF/GPS, in memory only.

    Raises SelfieImageError when the bytes are not a decodable image or exceed
    ``MAX_UPLOAD_BYTES``.
    """
    if not image_data:
        raise SelfieImageError("empty upload")
    if len(image_data) > MAX_UPLOAD_BYTES:
        raise SelfieImageError("image too large")

    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:  # pragma: no cover - optional dependency
        pass

    try:
        with Image.open(BytesIO(image_data)) as img:
            # Apply (then discard) the orientation tag so the model sees the
            # photo upright; re-encoding below drops every metadata block.
            img = ImageOps.exif_transpose(img)
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail((MAX_SELFIE_EDGE, MAX_SELFIE_EDGE), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    except SelfieImageError:
        raise
    except Exception as e:  # PIL raises a zoo of errors for broken files
        raise SelfieImageError(f"unreadable image: {type(e).__name__}") from None

    return base64.b64encode(buffer.getvalue()).decode("utf-8")


# A flat colour tile used as the placeholder photo when a detected garment is
# added to the wardrobe: no pixel of the selfie (and therefore of the person)
# ever becomes an item image.
_SWATCH_RGB: dict[str, tuple[int, int, int]] = {
    "black": (32, 32, 34),
    "white": (246, 246, 244),
    "gray": (150, 150, 152),
    "navy": (34, 44, 82),
    "blue": (52, 96, 190),
    "light-blue": (150, 194, 232),
    "red": (192, 52, 52),
    "burgundy": (114, 32, 48),
    "pink": (232, 160, 186),
    "green": (66, 132, 80),
    "olive": (110, 118, 62),
    "yellow": (232, 200, 72),
    "orange": (226, 132, 56),
    "purple": (118, 76, 160),
    "brown": (114, 80, 56),
    "tan": (196, 160, 116),
    "beige": (222, 206, 180),
    "cream": (240, 232, 210),
    "gold": (198, 166, 84),
    "silver": (196, 198, 200),
}
_SWATCH_FALLBACK = (214, 212, 208)


def build_color_swatch(color: str | None, size: int = 800) -> bytes:
    """A plain JPEG tile in the detected colour, used as a placeholder photo."""
    rgb = _SWATCH_RGB.get((color or "").lower(), _SWATCH_FALLBACK)
    image = Image.new("RGB", (size, size), rgb)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    return buffer.getvalue()


# --- Matching --------------------------------------------------------------------

# Weights of the score. Deliberately small and readable: the user always sees
# the alternatives and can correct the pick, so a transparent heuristic beats an
# opaque one. Maximum is 7.0 (exact type + exact colour + pattern + material +
# subtype).
TYPE_EXACT = 3.0
TYPE_SAME_ROLE = 1.5
COLOR_EXACT = 2.0
COLOR_FAMILY = 1.2
COLOR_SECONDARY = 1.0
COLOR_UNKNOWN = 0.5
PATTERN_EXACT = 1.0
PATTERN_PARTIAL = 0.3
PATTERN_MISMATCH = -0.8
MATERIAL_EXACT = 0.5
SUBTYPE_EXACT = 0.5

# Above this the UI says "esto es tu X" (and colour must agree at all).
MATCH_THRESHOLD = 4.0
MAX_ALTERNATIVES = 3

_COLOR_FAMILIES: tuple[frozenset[str], ...] = (
    frozenset({"navy", "blue", "light-blue"}),
    frozenset({"gray", "silver"}),
    frozenset({"white", "cream", "beige"}),
    frozenset({"beige", "tan", "cream"}),
    frozenset({"brown", "tan"}),
    frozenset({"red", "burgundy"}),
    frozenset({"pink", "red"}),
    frozenset({"green", "olive"}),
    frozenset({"yellow", "gold"}),
    frozenset({"yellow", "orange"}),
    frozenset({"purple", "burgundy"}),
)


def _same_color_family(a: str, b: str) -> bool:
    return any(a in fam and b in fam for fam in _COLOR_FAMILIES)


def _color_score(detected: DetectedGarment, item: ClothingItem) -> tuple[float, bool]:
    """(score, colour_agrees). ``colour_agrees`` gates a confident match."""
    wanted = detected.primary_color
    item_primary = (item.primary_color or "").lower() or None
    item_colors = [c.lower() for c in (item.colors or []) if c]

    if not wanted:
        return 0.0, False
    if not item_primary and not item_colors:
        return COLOR_UNKNOWN, False
    if item_primary and wanted == item_primary:
        return COLOR_EXACT, True
    if wanted in item_colors:
        return COLOR_SECONDARY, True
    if item_primary and _same_color_family(wanted, item_primary):
        return COLOR_FAMILY, True
    if any(_same_color_family(wanted, c) for c in item_colors):
        return COLOR_FAMILY, True
    # A secondary colour of the detection may still be the item's main colour.
    for alt in detected.colors[1:]:
        if item_primary and alt == item_primary:
            return COLOR_SECONDARY, True
    return 0.0, False


def _type_score(detected: DetectedGarment, item: ClothingItem) -> float:
    item_type = (item.type or "").lower()
    if not item_type or item_type == "unknown":
        return 0.0
    if item_type == detected.type:
        return TYPE_EXACT
    detected_role = ITEM_ROLE.get(detected.type)
    if detected_role and ITEM_ROLE.get(item_type) == detected_role:
        return TYPE_SAME_ROLE
    return 0.0


def _pattern_score(detected: DetectedGarment, item: ClothingItem) -> float:
    item_pattern = (item.pattern or "").lower() or None
    if not detected.pattern or not item_pattern:
        return PATTERN_PARTIAL
    if detected.pattern == item_pattern:
        return PATTERN_EXACT
    return PATTERN_MISMATCH


def score_item(detected: DetectedGarment, item: ClothingItem) -> tuple[float, bool]:
    """Score one wardrobe item against one detection.

    Returns ``(score, is_confident)``. A candidate with no type overlap scores
    0: a shirt is never offered for a pair of shoes.
    """
    type_score = _type_score(detected, item)
    if type_score <= 0:
        return 0.0, False

    color_score, color_agrees = _color_score(detected, item)
    score = type_score + color_score + _pattern_score(detected, item)

    if detected.material and item.material and detected.material == (item.material or "").lower():
        score += MATERIAL_EXACT
    if detected.subtype and item.subtype and detected.subtype == (item.subtype or "").lower():
        score += SUBTYPE_EXACT

    score = round(score, 2)
    confident = score >= MATCH_THRESHOLD and type_score == TYPE_EXACT and color_agrees
    return score, confident


@dataclass
class ScoredItem:
    item: ClothingItem
    score: float
    confident: bool


@dataclass
class GarmentMatch:
    detected: DetectedGarment
    match: ClothingItem | None
    alternatives: list[ClothingItem] = field(default_factory=list)


def _candidates(detected: DetectedGarment, items: list[ClothingItem]) -> list[ScoredItem]:
    scored: list[ScoredItem] = []
    for item in items:
        score, confident = score_item(detected, item)
        if score <= 0:
            continue
        scored.append(ScoredItem(item=item, score=score, confident=confident))
    # Ties break towards the item the user actually wears.
    scored.sort(key=lambda s: (s.score, s.item.wear_count or 0), reverse=True)
    return scored


def match_garments(
    detections: list[DetectedGarment], items: list[ClothingItem]
) -> list[GarmentMatch]:
    """Assign wardrobe items to detections, best score first, one item at most once.

    Confident matches are assigned greedily across all detections so the strong
    "this is exactly your navy hoodie" wins over a weaker claim on the same item
    elsewhere in the outfit. Everything else is offered as an alternative the
    user can pick.
    """
    per_detection = [_candidates(d, items) for d in detections]

    taken: set[UUID] = set()
    assigned: dict[int, ClothingItem] = {}

    confident_pairs = [
        (cand.score, idx, cand)
        for idx, cands in enumerate(per_detection)
        for cand in cands
        if cand.confident
    ]
    confident_pairs.sort(key=lambda p: (p[0], p[2].item.wear_count or 0), reverse=True)

    for _score, idx, cand in confident_pairs:
        if idx in assigned or cand.item.id in taken:
            continue
        assigned[idx] = cand.item
        taken.add(cand.item.id)

    results: list[GarmentMatch] = []
    for idx, detected in enumerate(detections):
        picked = assigned.get(idx)
        alternatives = [
            c.item
            for c in per_detection[idx]
            if c.item.id not in taken or (picked is not None and c.item.id == picked.id)
        ]
        if picked is not None:
            alternatives = [i for i in alternatives if i.id != picked.id]
        results.append(
            GarmentMatch(
                detected=detected,
                match=picked,
                alternatives=alternatives[:MAX_ALTERNATIVES],
            )
        )
    return results
