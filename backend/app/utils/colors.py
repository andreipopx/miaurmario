"""The garment's real shade, as a hex string.

Two jobs, both deliberately small:

* ``normalize_hex`` is the only gate on what reaches ``primary_color_hex``. The
  column is display-only, but it still goes straight into a ``style`` attribute
  in the browser, so nothing that is not exactly ``#rrggbb`` is allowed through.
* ``dominant_garment_hex`` guesses that shade from the stored photo, so the AI
  path can keep a representative hex without asking the vision model for one.

Neither of these classifies a colour. The family (``primary_color``) still comes
from the tagger or from the user, and everything downstream — filters, the
scorer, the stylist — reasons on that name, so a sampled hex can never change
which family a garment belongs to.
"""

import logging
import re
from collections import Counter

from PIL import Image

logger = logging.getLogger(__name__)

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")
_SHORT_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{3})$")

# The cut-out is composited onto solid white before it is stored, so anything
# this bright is background rather than fabric. Cream and white garments do get
# dropped by this — which is why a failed sample is a null hex and not a guess.
_BACKGROUND_MIN = 244
# Pure black is usually a shadow or a hard outline rather than the garment.
_SHADOW_MAX = 12
# Sampling side length: enough pixels to be stable, few enough to be free.
_SAMPLE_SIDE = 64
# Bucket width per channel, so near-identical pixels count as the same shade.
_BUCKET = 24


def normalize_hex(value: str | None) -> str | None:
    """``"#ABC"`` / ``"abccde"`` -> ``"#abccde"``; anything else -> ``None``."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    short = _SHORT_HEX_RE.match(candidate)
    if short:
        return "#" + "".join(c * 2 for c in short.group(1)).lower()
    match = _HEX_RE.match(candidate)
    if not match:
        return None
    return f"#{match.group(1).lower()}"


def _is_fabric(r: int, g: int, b: int, a: int) -> bool:
    if a < 128:
        return False
    if r >= _BACKGROUND_MIN and g >= _BACKGROUND_MIN and b >= _BACKGROUND_MIN:
        return False
    return not (r <= _SHADOW_MAX and g <= _SHADOW_MAX and b <= _SHADOW_MAX)


def dominant_hex_from_image(image: Image.Image) -> str | None:
    """The most common fabric shade in a garment photo, or ``None``.

    Background (the white the cut-out is composited onto, or a transparent alpha
    if a provider ever hands us a PNG) and near-black shadow are dropped first;
    what is left is bucketed so that near-identical pixels count together, and
    the biggest bucket's mean is returned. ``None`` means "we could not tell" —
    an all-white garment, an empty image — and the caller leaves the hex null
    rather than storing a shade the user never saw.
    """
    try:
        sample = image.convert("RGBA")
        sample.thumbnail((_SAMPLE_SIDE, _SAMPLE_SIDE), Image.Resampling.LANCZOS)
        pixels = list(sample.getdata())
    except Exception as exc:  # pragma: no cover - a corrupt image is not a crash
        logger.warning("Could not sample a dominant colour: %s", exc)
        return None

    buckets: Counter[tuple[int, int, int]] = Counter()
    sums: dict[tuple[int, int, int], list[int]] = {}
    for r, g, b, a in pixels:
        if not _is_fabric(r, g, b, a):
            continue
        key = (r // _BUCKET, g // _BUCKET, b // _BUCKET)
        buckets[key] += 1
        total = sums.setdefault(key, [0, 0, 0])
        total[0] += r
        total[1] += g
        total[2] += b

    if not buckets:
        return None

    key, count = buckets.most_common(1)[0]
    total = sums[key]
    return "#{:02x}{:02x}{:02x}".format(*(channel // count for channel in total))


def dominant_garment_hex(image_path: str) -> str | None:
    """``dominant_hex_from_image`` for a file on disk; never raises."""
    try:
        with Image.open(image_path) as image:
            return dominant_hex_from_image(image)
    except Exception as exc:
        logger.warning("Could not open %s to sample a colour: %s", image_path, exc)
        return None
