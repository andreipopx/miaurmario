"""Which side of a garment a photo shows.

A leaf module, like ``image_formats``: the model, the schemas and the API all need
the same three labels and the same reading of "no label at all", and a schema
importing the models would drag the database into the response layer.
"""

import enum
from typing import Any

from sqlalchemy import inspect as sa_inspect

__all__ = ["ImageView", "back_photo_paths", "normalize_image_view"]


class ImageView(enum.StrEnum):
    """The side of the garment a photo shows.

    Stored as a plain string rather than a PostgreSQL enum: this is a label on a
    photo, and a label wants to be cheap to add to.
    """

    front = "front"
    back = "back"
    detail = "detail"


#: Every label, as the strings that go over the wire.
IMAGE_VIEWS = frozenset(v.value for v in ImageView)


def normalize_image_view(value: object) -> str:
    """The view of a photo, with "nothing recorded" and junk both reading as front.

    Every photo taken before views existed has a null column, and nobody is going
    to go back and label them: a front photo is the honest guess, and it is also
    what a garment with one photo means. Anything the column should not contain is
    read the same way rather than raising — one bad label must not take a wardrobe
    down.
    """
    if isinstance(value, ImageView):
        return value.value
    if isinstance(value, str) and value in IMAGE_VIEWS:
        return value
    return ImageView.front.value


def back_photo_paths(item: Any) -> tuple[str, str | None] | None:
    """``(image_path, thumbnail_path)`` of a garment's back photo, or ``None``.

    Takes the ORM garment, so the outfit responses can answer "does this look have
    a behind?" without loading a whole `ItemResponse` per piece.

    Silently answers ``None`` when the gallery was not eager-loaded, instead of
    lazy-loading it: a caller in an async request would get a ``MissingGreenlet``
    rather than a back photo, and "no back photo" is a shape every screen already
    handles. Every outfit query that feeds a flat lay loads the gallery; this is the
    net under the ones that do not.
    """
    if item is None:
        return None
    if normalize_image_view(getattr(item, "image_view", None)) == ImageView.back.value:
        return item.image_path, getattr(item, "thumbnail_path", None)
    try:
        if "additional_images" in sa_inspect(item).unloaded:
            return None
    except Exception:  # noqa: BLE001 — a plain object (a test double) is fine too
        pass
    for image in getattr(item, "additional_images", None) or []:
        if normalize_image_view(getattr(image, "image_view", None)) == ImageView.back.value:
            return image.image_path, getattr(image, "thumbnail_path", None)
    return None
