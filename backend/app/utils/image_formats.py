"""How a stored garment image is encoded, told from its filename.

A leaf module on purpose: the item schemas need to say whether an image is a
cut-out, and importing ``app.services.image_service`` from a schema closes an
import cycle (``app.services`` imports the schemas).
"""

from pathlib import Path

#: Cut-outs are stored as WebP: it is the only format that is both small and
#: universally supported *with* an alpha channel, and a garment whose background
#: has been removed has to keep its transparency — composited onto white it is
#: just a photo of a white card.
CUTOUT_SUFFIX = ".webp"

#: Formats that can carry alpha, so an image stored as one may be a cut-out.
#: WebP is what the pipeline writes; PNG shows up in seeded and imported items.
CUTOUT_SUFFIXES = frozenset({CUTOUT_SUFFIX, ".png"})


def is_cutout_path(path: str | None) -> bool:
    """True for a stored image that keeps its alpha channel."""
    return bool(path) and Path(str(path)).suffix.lower() in CUTOUT_SUFFIXES
