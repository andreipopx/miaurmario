import shutil
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path

import imagehash
from PIL import Image, ImageChops, ImageOps

from app.config import get_settings
from app.services import background_removal
from app.utils.image_formats import CUTOUT_SUFFIX, is_cutout_path

settings = get_settings()

__all__ = [
    "CUTOUT_SUFFIX",
    "CropBox",
    "CutoutState",
    "ImageService",
    "apply_brush_mask",
    "is_cutout_path",
    "sidecar_paths",
    "strip_metadata",
    "trim_box",
    "trim_transparent",
    "upright",
]

# Image size configurations
# Thumbnail: Used in cards/grids. 400px supports ~200px display on retina
# Medium: Used in detail views and outfit displays
# Original: Full resolution for zoom/download
SIZES = {
    "thumbnail": (400, 400),
    "medium": (800, 800),
    "original": (2400, 2400),
}

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


@dataclass(frozen=True)
class CropBox:
    """What to keep, in pixels of the upright (and already rotated) image."""

    x: int
    y: int
    width: int
    height: int


#: A crop smaller than this is a mis-click or a rounding artefact, not an intent.
MIN_CROP_PX = 8

#: The automatic cut-out's alpha, kept beside the photo so "volver al automático"
#: has something to go back to after the user has painted on it. Full frame — the
#: size of the stored original, before ``trim_transparent`` crops the cut-out.
AUTO_ALPHA_SUFFIX = "_autoalpha.png"

#: The alpha actually in force, once the user has erased or restored anything.
#: Absent means "nobody has touched the automatic result".
EDIT_ALPHA_SUFFIX = "_editalpha.png"

#: Brush strokes made while adding a photo, before there was an item to attach
#: them to: framed with the photo at upload and applied once the cut-out exists.
BRUSH_SUFFIX = "_brush.png"

#: The untouched photo, kept so the cut-out can always be undone.
BACKUP_SUFFIX = "_orig.jpg"


def stem_of(image_path: str) -> str:
    """The name an item's files share, without extension.

    Deliberately the stem: the same garment is a ``.jpg`` photo before background
    removal and a ``.webp`` cut-out after it, and every sidecar has to keep the
    same name across that change or a second removal would orphan the first one's.
    """
    return image_path.rsplit(".", 1)[0]


def sidecar_paths(image_path: str) -> list[str]:
    """Every file stored beside a garment image that is not one of its three sizes."""
    stem = stem_of(image_path)
    return [
        f"{stem}{BACKUP_SUFFIX}",
        f"{stem}{AUTO_ALPHA_SUFFIX}",
        f"{stem}{EDIT_ALPHA_SUFFIX}",
        f"{stem}{BRUSH_SUFFIX}",
    ]


@dataclass(frozen=True)
class CutoutState:
    """What the eraser works on, all in the coordinates of the stored photo.

    ``rgb`` is the garment as photographed — the untouched backup when there is
    one, so that restoring a part the automatic cut-out wrongly removed brings
    real pixels back rather than the black the cut-out stores under its
    transparency. ``auto`` is what the model decided, ``current`` is what is on
    screen now (the same thing until the user paints).
    """

    rgb: Image.Image
    auto: Image.Image
    current: Image.Image
    edited: bool


def apply_brush_mask(alpha: Image.Image, mask: Image.Image) -> Image.Image:
    """Erase and restore where the user painted.

    The mask is an RGBA image the size of ``alpha``: **red erases, green
    restores**, and the mask's own alpha is how hard. Two channels rather than one
    grey ramp because a soft brush edge then stays unambiguous — a half-covered
    pixel is a half-strength stroke, never "half erase, half restore".

    Erasing scales the alpha down towards nothing and restoring scales it up
    towards opaque, so a stroke over the garment's feathered edge softens or firms
    it rather than stamping a hard line across it.
    """
    if mask.size != alpha.size:
        mask = mask.resize(alpha.size, Image.Resampling.BILINEAR)
    red, green, _, strength = mask.split()
    erase = ImageChops.multiply(red, strength)
    restore = ImageChops.multiply(green, strength)
    # alpha * (1 - erase)
    alpha = ImageChops.subtract(alpha, ImageChops.multiply(alpha, erase))
    # alpha + (255 - alpha) * restore
    return ImageChops.add(alpha, ImageChops.multiply(ImageChops.invert(alpha), restore))


def _encode(image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    image.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


#: libwebp's compression effort. It used to be 6, its most thorough setting, which
#: measured at 3.4s for a 1800x2400 cut-out against 0.45s at 4 — and bought 2% in
#: file size for it. Every cut-out write pays this three times (all three sizes), so
#: at 6 a single quarter turn cost about 2.5 seconds of pure encoding. Measured at
#: quality 95/90/88 on a busy garment with a soft-edged hole:
#:
#:   method   original 2400px   medium 800px   thumb 400px   bytes vs method 6
#:   6        3.4s              3.2s           4.4s          --
#:   4        0.45s             0.09s          0.05s         +2%
#:   2        0.26s             0.05s          0.02s         +8% / +4% / +2%
WEBP_METHOD = 4


def _encode_alpha(image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    image.save(output, format="WEBP", quality=quality, method=WEBP_METHOD)
    return output.getvalue()


def trim_box(alpha: Image.Image, padding: float = 0.02) -> tuple[int, int, int, int] | None:
    """The crop ``trim_transparent`` would take, or ``None`` to keep the whole frame.

    Split out from ``trim_transparent`` because the eraser needs to know *where* in
    the stored photo the cut-out the user is painting on came from: the brush
    strokes arrive in the trimmed image's coordinates and have to be put back.
    """
    box = alpha.getbbox()
    if box is None:
        return None
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    if width * height < 0.05 * alpha.width * alpha.height:
        return None
    pad = int(round(max(width, height) * padding))
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(alpha.width, right + pad),
        min(alpha.height, bottom + pad),
    )


def trim_transparent(image: Image.Image, padding: float = 0.02) -> Image.Image:
    """Crop away a fully transparent border, leaving a small breathing margin.

    A cut-out inherits the framing of the photo it came from, which usually means
    a garment adrift in a sea of nothing. Trimming lets the tile show the garment
    rather than the space around it. Guarded: a bounding box that swallows most of
    the picture is a bad mask, not a tight crop, so the image is left alone.
    """
    if image.mode != "RGBA":
        return image
    box = trim_box(image.getchannel("A"), padding)
    return image if box is None else image.crop(box)


def strip_metadata(image: Image.Image) -> Image.Image:
    """A fresh image built from raw pixels, so nothing in ``info`` survives.

    Re-encoding alone is not enough: Pillow carries ``exif``, ``xmp`` and the ICC
    profile along in ``Image.info`` and hands them to the encoder, which is how a
    photo's GPS coordinates end up in a wardrobe thumbnail. Copying the pixels into
    a new image leaves every one of those behind. The avatar service does the same
    thing for profile photos.
    """
    if image.mode in ("P", "PA"):
        image = image.convert("RGBA")
    clean = Image.frombytes(image.mode, image.size, image.tobytes())
    return clean


def upright(image: Image.Image) -> Image.Image:
    """Turn a photo the way the camera was held, then forget it ever knew.

    Phones almost never rotate the pixels: they leave the sensor's orientation in
    an EXIF tag and expect whoever reads the file to honour it. Nothing downstream
    here does — thumbnails, the perceptual hash and the background cut-out all work
    on raw pixels — so a photo of jeans taken in portrait was stored on its side.
    """
    turned = ImageOps.exif_transpose(image)
    return strip_metadata(turned if turned is not None else image)


def rotate_quarters(image: Image.Image, quarters: int) -> Image.Image:
    """Turn the image by ``quarters`` * 90 degrees clockwise (negative: anticlockwise).

    Pillow short-circuits a right-angle ``rotate(expand=True)`` to a transpose, so
    this moves bytes around and resamples nothing: a quarter turn costs no quality.
    """
    turns = quarters % 4
    if turns == 0:
        return image
    # PIL rotates anticlockwise, and the user's "right" is clockwise.
    return image.rotate(-90 * turns, expand=True)


def apply_crop(image: Image.Image, crop: CropBox | None) -> Image.Image:
    """Keep ``crop``, clamped to the image; a degenerate box keeps everything."""
    if crop is None or crop.width < MIN_CROP_PX or crop.height < MIN_CROP_PX:
        return image
    width = min(crop.width, image.width)
    height = min(crop.height, image.height)
    left = min(max(crop.x, 0), image.width - width)
    top = min(max(crop.y, 0), image.height - height)
    return image.crop((left, top, left + width, top + height))


class ImageService:
    def __init__(self, storage_path: str | None = None):
        self.storage_path = Path(storage_path or settings.storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

    def _get_user_path(self, user_id: uuid.UUID) -> Path:
        user_path = self.storage_path / str(user_id)
        user_path.mkdir(parents=True, exist_ok=True)
        return user_path

    def _generate_filename(self, extension: str = ".jpg") -> str:
        """Generate a unique filename."""
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        return f"{timestamp}_{unique_id}{extension}"

    def _convert_heic(self, image_data: bytes) -> Image.Image:
        """Convert HEIC/HEIF to PIL Image."""
        try:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        except ImportError:
            pass

        return Image.open(BytesIO(image_data))

    def load_upload(
        self,
        image_data: bytes,
        original_filename: str,
        *,
        rotate: int = 0,
        crop: CropBox | None = None,
    ) -> Image.Image:
        """Decode an upload into the pixels we are going to keep.

        Every ingest path goes through here, in this order: honour the camera's EXIF
        orientation (and drop the metadata), then the quarter turns the user asked
        for in the preview, then their crop. The hash and all three stored sizes are
        computed from the result, so a photo is never stored sideways and the
        duplicate check compares what the user actually saved.
        """
        return self.load_framed(image_data, original_filename, rotate=rotate, crop=crop)[0]

    def load_framed(
        self,
        image_data: bytes,
        original_filename: str,
        *,
        rotate: int = 0,
        crop: CropBox | None = None,
    ) -> tuple[Image.Image, tuple[int, int]]:
        """``load_upload``, plus the size the photo had *before* the crop.

        That intermediate size is the coordinate space the add form's eraser paints
        in — the photo uprighted and turned, but not yet cropped, because the crop
        is a separate tool the user can still change. Returning it here means the
        mask can be framed with exactly the same steps as the pixels, in the same
        order, without decoding the upload twice.
        """
        ext = Path(original_filename).suffix.lower()
        if ext in (".heic", ".heif"):
            image = self._convert_heic(image_data)
        else:
            image = Image.open(BytesIO(image_data))
        turned = rotate_quarters(upright(image), rotate)
        return apply_crop(turned, crop), turned.size

    def _flatten_rgb(self, image: Image.Image) -> Image.Image:
        """Garments are stored as JPEG, so transparency is composited onto white."""
        if image.mode in ("RGBA", "P", "PA", "LA"):
            rgba = image.convert("RGBA")
            background = Image.new("RGB", rgba.size, (255, 255, 255))
            background.paste(rgba, mask=rgba.getchannel("A"))
            return background
        if image.mode != "RGB":
            return image.convert("RGB")
        return image

    def _encode_jpeg(self, image: Image.Image, quality: int) -> bytes:
        """Flatten, strip every scrap of metadata, encode."""
        return _encode(strip_metadata(self._flatten_rgb(image)), quality)

    def _encode_cutout(self, image: Image.Image, quality: int) -> bytes:
        """WebP with the alpha channel intact, and no metadata."""
        return _encode_alpha(strip_metadata(image.convert("RGBA")), quality)

    def composite_on(
        self, image: Image.Image, bg_color: tuple[int, int, int] = (255, 255, 255)
    ) -> Image.Image:
        """A cut-out on a solid colour, for the places that need a flat picture.

        Sharing, export and the vision model all want an ordinary opaque image.
        What is *stored* keeps its alpha; flattening happens at the point of use.
        """
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (*bg_color, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background.convert("RGB")

    def _resize_image(
        self,
        image: Image.Image,
        max_size: tuple[int, int],
        quality: int = 92,
    ) -> bytes:
        """Resize image maintaining aspect ratio."""
        image = self._flatten_rgb(image)

        # Resize maintaining aspect ratio
        image.thumbnail(max_size, Image.Resampling.LANCZOS)

        return self._encode_jpeg(image, quality)

    async def process_and_store(
        self,
        user_id: uuid.UUID,
        image_data: bytes,
        original_filename: str,
        *,
        rotate: int = 0,
        crop: CropBox | None = None,
        erase_mask: bytes | None = None,
    ) -> dict[str, str]:
        """
        Process an uploaded image and store all sizes.

        Returns dict with paths for each size:
        {
            "original": "user_id/20240116_123456_abc123.jpg",
            "medium": "user_id/20240116_123456_abc123_medium.jpg",
            "thumbnail": "user_id/20240116_123456_abc123_thumb.jpg",
        }
        """
        # Validate file extension
        ext = Path(original_filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")

        # Upright, turned and cropped as the user framed it
        image, turned_size = self.load_framed(
            image_data, original_filename, rotate=rotate, crop=crop
        )

        # Generate base filename
        base_filename = self._generate_filename(".jpg")
        base_name = base_filename.rsplit(".", 1)[0]

        user_path = self._get_user_path(user_id)
        paths = {}

        # Process and save each size
        for size_name, max_size in SIZES.items():
            if size_name == "original":
                suffix = ""
                quality = 95  # Highest quality for original
            elif size_name == "medium":
                suffix = "_medium"
                quality = 90
            else:
                suffix = "_thumb"
                quality = 88  # Good quality for thumbnails

            filename = f"{base_name}{suffix}.jpg"
            file_path = user_path / filename

            # For original, preserve as much quality as possible
            # For others, resize with appropriate quality
            resized_data = self._resize_image(image.copy(), max_size, quality=quality)
            file_path.write_bytes(resized_data)

            # Store relative path
            paths[size_name] = f"{user_id}/{filename}"

        # Compute perceptual hash for duplicate detection, on the same pixels
        image_hash = self.phash_of(image)

        if erase_mask:
            # Framed like the photo and parked beside it. Background removal applies
            # it against the alpha the model produces; with no removal in the flow,
            # `apply_pending_brush` applies it to the opaque photo instead. Either
            # way the strokes are not lost between the upload and the cut-out.
            stored = Image.open(self.storage_path / paths["original"])
            self.store_pending_brush(
                paths["original"],
                erase_mask,
                turned_size=turned_size,
                crop=crop,
                stored_size=stored.size,
            )
            stored.close()

        return {
            "image_path": paths["original"],
            "medium_path": paths["medium"],
            "thumbnail_path": paths["thumbnail"],
            "image_hash": image_hash,
        }

    def get_image_path(self, relative_path: str) -> Path:
        """Get full path for an image."""
        return self.storage_path / relative_path

    def delete_images(self, paths: dict[str, str | None]) -> None:
        """Delete all image files for an item, sidecars included.

        The backup photo and the two stored alphas are named after the image's
        stem rather than listed on the item, so a caller that only knows the three
        sizes would leave them behind for ever.
        """
        for path in paths.values():
            if path:
                full_path = self.storage_path / path
                if full_path.exists():
                    full_path.unlink()
        for path in paths.values():
            if path:
                for sidecar in sidecar_paths(path):
                    self._discard(sidecar)

    def validate_image(self, image_data: bytes, content_type: str) -> bool:
        """Validate image data and content type."""
        # Check content type
        if content_type not in ALLOWED_MIME_TYPES:
            return False

        # Check file size (max 20MB)
        if len(image_data) > 20 * 1024 * 1024:
            return False

        # Try to open as image
        try:
            if content_type in ("image/heic", "image/heif"):
                self._convert_heic(image_data)
            else:
                Image.open(BytesIO(image_data))
            return True
        except Exception:
            return False

    def phash_of(self, image: Image.Image) -> str:
        """pHash of an already-decoded image."""
        if image.mode != "RGB":
            image = image.convert("RGB")
        return str(imagehash.phash(image))

    def compute_phash(
        self,
        image_data: bytes,
        original_filename: str,
        *,
        rotate: int = 0,
        crop: CropBox | None = None,
    ) -> str:
        """
        Compute perceptual hash (pHash) for an image.

        Hashed after the orientation, rotation and crop are applied, so the same
        photo hashes the same whether the phone tagged it portrait or landscape —
        and so the duplicate check compares the garment the user is saving.

        Returns a 16-character hex string representing the 64-bit hash.
        """
        return self.phash_of(
            self.load_upload(image_data, original_filename, rotate=rotate, crop=crop)
        )

    def compute_phash_from_path(self, image_path: Path) -> str:
        """Compute pHash from a file path."""
        image = Image.open(image_path)
        if image.mode != "RGB":
            image = image.convert("RGB")
        phash = imagehash.phash(image)
        return str(phash)

    @staticmethod
    def hash_distance(hash1: str, hash2: str) -> int:
        """
        Compute Hamming distance between two hashes.

        Lower distance = more similar images.
        Distance 0 = identical/near-identical images.
        Distance < 10 = very similar images.
        """
        h1 = imagehash.hex_to_hash(hash1)
        h2 = imagehash.hex_to_hash(hash2)
        return h1 - h2

    @staticmethod
    def is_duplicate(hash1: str, hash2: str, threshold: int = 8) -> bool:
        """
        Check if two images are duplicates based on hash distance.

        Default threshold of 8 catches near-identical images while allowing
        for minor differences in lighting/compression.
        """
        return ImageService.hash_distance(hash1, hash2) <= threshold

    def _save_all_sizes(self, image: Image.Image, image_path: str) -> dict[str, str]:
        """Write all three sizes of ``image``, in the format ``image_path`` names.

        A ``.webp`` target keeps its alpha channel; anything else is flattened to
        JPEG. Deriving the format from the path rather than from a flag means the
        bytes on disk always match the extension the browser is served.
        """
        suffix = Path(image_path).suffix or ".jpg"
        cutout = suffix.lower() == CUTOUT_SUFFIX
        base_path = image_path[: -len(suffix)]
        medium_path = f"{base_path}_medium{suffix}"
        thumb_path = f"{base_path}_thumb{suffix}"

        for size_name, max_size in SIZES.items():
            if size_name == "original":
                file_path = self.storage_path / image_path
                quality = 95
            elif size_name == "medium":
                file_path = self.storage_path / medium_path
                quality = 90
            else:
                file_path = self.storage_path / thumb_path
                quality = 88

            img_copy = image.copy()
            img_copy.thumbnail(max_size, Image.Resampling.LANCZOS)
            file_path.write_bytes(
                self._encode_cutout(img_copy, quality)
                if cutout
                else self._encode_jpeg(img_copy, quality)
            )

        return {
            "image_path": image_path,
            "medium_path": medium_path,
            "thumbnail_path": thumb_path,
        }

    def remove_background(
        self,
        image_path: str,
        bg_color: tuple[int, int, int] | None = None,
    ) -> dict[str, str]:
        """Cut the garment out and store it with its transparency intact.

        The result is written as WebP under the same stem, so the returned paths
        differ from the ones passed in and the caller must save them on the item.
        ``bg_color`` composites onto a solid colour instead and keeps the JPEG
        paths — only for a caller that genuinely wants a flat picture.
        """
        # Deliberately the stem without the extension: the same garment can be a
        # .jpg photo now and a .webp cut-out after this call, and the backup has to
        # keep the same name either way or a second removal would overwrite it.
        base_path = stem_of(image_path)
        original_full = self.storage_path / image_path

        if not original_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        backup_path = self.ensure_backup(image_path)

        # Always from the untouched photo, never from a cut-out we made earlier: a
        # second removal on an already-transparent image asks the model to find a
        # garment on a white card, and anything the user erased by hand would be
        # baked in as white before the model ever saw it.
        source_full = self.storage_path / backup_path
        if not source_full.exists():
            source_full = original_full
        image = self._flatten_rgb(Image.open(source_full))
        provider = background_removal.get_provider()
        result = provider.remove(image).convert("RGBA")

        if bg_color is not None:
            paths = self._save_all_sizes(self.composite_on(result, bg_color), f"{base_path}.jpg")
            paths["original_backup_path"] = backup_path
            return paths

        # What the model decided, kept at full frame: it is the thing "volver al
        # automático" goes back to, and the base every later brush stroke edits.
        # A fresh removal also discards whatever the user had painted on the
        # previous one — those strokes were drawn against a mask that no longer
        # exists.
        alpha = result.getchannel("A")
        self._write_alpha(f"{base_path}{AUTO_ALPHA_SUFFIX}", alpha)
        self._discard(f"{base_path}{EDIT_ALPHA_SUFFIX}")

        pending = self.storage_path / f"{base_path}{BRUSH_SUFFIX}"
        if pending.exists():
            # Strokes the user made in the add form, before this garment existed.
            with Image.open(pending) as mask:
                alpha = apply_brush_mask(alpha, mask.convert("RGBA"))
            self._write_alpha(f"{base_path}{EDIT_ALPHA_SUFFIX}", alpha)
            self._discard(f"{base_path}{BRUSH_SUFFIX}")

        # The provider's own pixels, not the source photo's: a provider that does
        # alpha matting hands back a decontaminated foreground (background bleed
        # taken out of the feathered edge) and throwing that away would be a
        # downgrade. Hand edits re-render from the backup photo instead, because a
        # stored cut-out has nothing useful under its transparency to restore from.
        paths = self._render_cutout(result, alpha, image_path)
        paths["original_backup_path"] = backup_path
        return paths

    def ensure_backup(self, image_path: str) -> str:
        """The untouched photo, copied aside the first time we change the stored one."""
        backup_path = f"{stem_of(image_path)}{BACKUP_SUFFIX}"
        backup_full = self.storage_path / backup_path
        # First removal wins: a second removal must not overwrite the true
        # original with an already-processed image
        if not backup_full.exists():
            original_full = self.storage_path / image_path
            if is_cutout_path(image_path):
                # Nothing to back up losslessly: flatten the cut-out we have.
                backup_full.write_bytes(self._encode_jpeg(Image.open(original_full), 95))
            else:
                shutil.copy2(original_full, backup_full)
        return backup_path

    def _write_alpha(self, relative_path: str, alpha: Image.Image) -> None:
        """A single-channel PNG: lossless, because it is edited again and again."""
        buffer = BytesIO()
        alpha.convert("L").save(buffer, format="PNG", optimize=True)
        (self.storage_path / relative_path).write_bytes(buffer.getvalue())

    def _discard(self, relative_path: str) -> None:
        try:
            (self.storage_path / relative_path).unlink(missing_ok=True)
        except OSError:
            pass

    def _render_cutout(
        self, rgb: Image.Image, alpha: Image.Image, image_path: str
    ) -> dict[str, str]:
        """Write all three sizes of ``rgb`` wearing ``alpha``, as a WebP cut-out."""
        rgba = rgb.convert("RGBA")
        rgba.putalpha(alpha if alpha.size == rgba.size else alpha.resize(rgba.size))
        return self._save_all_sizes(trim_transparent(rgba), f"{stem_of(image_path)}{CUTOUT_SUFFIX}")

    def read_cutout_state(self, image_path: str, backup_path: str | None = None) -> CutoutState:
        """Load everything needed to edit a garment's transparency.

        Works on a garment that was never cut out, too: the whole photo counts as
        the garment until the user erases some of it, which is what makes the
        eraser useful with no AI and no rembg at all.
        """
        stem = stem_of(image_path)
        current_full = self.storage_path / image_path
        if not current_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        backup_full = self.storage_path / (backup_path or f"{stem}{BACKUP_SUFFIX}")
        stored_alpha: Image.Image | None = None
        if backup_full.exists():
            rgb = self._open_flat(backup_full)
        else:
            with Image.open(current_full) as current:
                current.load()
                if current.mode in ("RGBA", "LA", "PA", "P"):
                    stored_alpha = current.convert("RGBA").getchannel("A")
                rgb = self._flatten_rgb(current)
                if rgb is current:
                    # `_flatten_rgb` hands an already-RGB image straight back, and
                    # closing the file would leave it unreadable.
                    rgb = current.copy()

        auto_path = self.storage_path / f"{stem}{AUTO_ALPHA_SUFFIX}"
        if auto_path.exists():
            auto = self._read_alpha(auto_path, rgb.size)
        elif stored_alpha is not None:
            # A cut-out from before the alpha was kept beside the photo (a seeded or
            # imported item): its own transparency is the best "automatic" we have.
            auto = stored_alpha if stored_alpha.size == rgb.size else stored_alpha.resize(rgb.size)
        else:
            auto = Image.new("L", rgb.size, 255)

        edit_path = self.storage_path / f"{stem}{EDIT_ALPHA_SUFFIX}"
        edited = edit_path.exists()
        current_alpha = self._read_alpha(edit_path, rgb.size) if edited else auto
        return CutoutState(rgb=rgb, auto=auto, current=current_alpha, edited=edited)

    def _open_flat(self, path: Path) -> Image.Image:
        """An opaque RGB image detached from its file, safe to keep and edit."""
        with Image.open(path) as opened:
            opened.load()
            flat = self._flatten_rgb(opened)
            return flat.copy() if flat is opened else flat

    def _read_alpha(self, path: Path, size: tuple[int, int]) -> Image.Image:
        with Image.open(path) as stored:
            alpha = stored.convert("L")
            return alpha if alpha.size == size else alpha.resize(size, Image.Resampling.BILINEAR)

    def brush_cutout(
        self,
        image_path: str,
        mask_data: bytes,
        *,
        backup_path: str | None = None,
        mask_space: str = "cutout",
    ) -> dict[str, str]:
        """Erase or restore part of a garment, and re-render every stored size.

        ``mask_space`` says where the strokes were painted. ``cutout`` is the
        picture the user is actually looking at — the trimmed cut-out — so the mask
        is put back inside the frame at the box the trim took, recomputed here from
        the same alpha the trim used. ``original`` is the whole stored photo, which
        is what the add form paints on.
        """
        state = self.read_cutout_state(image_path, backup_path)
        with Image.open(BytesIO(mask_data)) as opened:
            mask = opened.convert("RGBA")

        if mask_space == "cutout":
            mask = self._place_in_frame(mask, trim_box(state.current), state.rgb.size)
        elif mask_space != "original":
            raise ValueError(f"Unknown mask space: {mask_space}")

        alpha = apply_brush_mask(state.current, mask)
        stem = stem_of(image_path)
        # The garment may never have been cut out, in which case there is no
        # automatic result on disk yet and this edit is the first thing that made
        # it transparent. Record both, so "volver al automático" means something.
        backup = self.ensure_backup(image_path)
        if not (self.storage_path / f"{stem}{AUTO_ALPHA_SUFFIX}").exists():
            self._write_alpha(f"{stem}{AUTO_ALPHA_SUFFIX}", state.auto)
        self._write_alpha(f"{stem}{EDIT_ALPHA_SUFFIX}", alpha)

        paths = self._render_cutout(state.rgb, alpha, image_path)
        paths["original_backup_path"] = backup
        return paths

    def reset_cutout(self, image_path: str, backup_path: str | None = None) -> dict[str, str]:
        """Throw the user's strokes away and go back to what the model decided."""
        state = self.read_cutout_state(image_path, backup_path)
        stem = stem_of(image_path)
        self._discard(f"{stem}{EDIT_ALPHA_SUFFIX}")
        paths = self._render_cutout(state.rgb, state.auto, image_path)
        paths["original_backup_path"] = self.ensure_backup(image_path)
        return paths

    def _place_in_frame(
        self,
        mask: Image.Image,
        box: tuple[int, int, int, int] | None,
        size: tuple[int, int],
    ) -> Image.Image:
        """A mask painted on the trimmed cut-out, put back where that crop came from."""
        left, top, right, bottom = box or (0, 0, *size)
        scaled = mask.resize((right - left, bottom - top), Image.Resampling.BILINEAR)
        full = Image.new("RGBA", size, (0, 0, 0, 0))
        full.paste(scaled, (left, top))
        return full

    def store_pending_brush(
        self,
        image_path: str,
        mask_data: bytes,
        *,
        turned_size: tuple[int, int],
        crop: CropBox | None,
        stored_size: tuple[int, int] | None = None,
    ) -> None:
        """Keep strokes made in the add form until there is a cut-out to apply them to.

        The add form paints on the photo as it is displayed — uprighted and turned,
        but *not* yet cropped, because the crop is a separate tool the user may still
        change. So the mask goes through the same framing the photo does, in the same
        order, and is stored at the size of the pixels we actually kept.
        """
        with Image.open(BytesIO(mask_data)) as opened:
            mask = opened.convert("RGBA")
        if mask.size != turned_size:
            mask = mask.resize(turned_size, Image.Resampling.BILINEAR)
        mask = apply_crop(mask, crop)
        target = self.storage_path / f"{stem_of(image_path)}{BRUSH_SUFFIX}"
        if stored_size is None:
            with Image.open(self.storage_path / image_path) as stored:
                stored_size = stored.size
        if mask.size != stored_size:
            mask = mask.resize(stored_size, Image.Resampling.BILINEAR)
        buffer = BytesIO()
        mask.save(buffer, format="PNG", optimize=True)
        target.write_bytes(buffer.getvalue())

    def apply_pending_brush(
        self, image_path: str, backup_path: str | None = None
    ) -> dict[str, str] | None:
        """Apply add-form strokes to a garment whose background was never removed.

        When removal runs it picks the pending mask up itself, against the alpha the
        model just produced. This is the other path: no AI, no rembg, or removal
        turned off — the strokes are still the user's instruction, so they are
        applied to an opaque photo and the garment becomes a cut-out with exactly
        the bits they wiped away missing.
        """
        pending = self.storage_path / f"{stem_of(image_path)}{BRUSH_SUFFIX}"
        if not pending.exists():
            return None
        mask_data = pending.read_bytes()
        paths = self.brush_cutout(
            image_path, mask_data, backup_path=backup_path, mask_space="original"
        )
        self._discard(f"{stem_of(image_path)}{BRUSH_SUFFIX}")
        return paths

    def restore_original(self, image_path: str, backup_path: str) -> dict[str, str]:
        """Put the untouched photo back, under the .jpg names it originally had."""
        backup_full = self.storage_path / backup_path
        if not backup_full.exists():
            raise ValueError(f"Backup not found: {backup_path}")

        image = Image.open(backup_full).convert("RGB")
        # The backup is named after the original, so it says where to restore to —
        # `image_path` may by now be the .webp cut-out we are throwing away.
        if backup_path.endswith(BACKUP_SUFFIX):
            target = f"{backup_path[: -len(BACKUP_SUFFIX)]}.jpg"
        else:
            target = f"{stem_of(image_path)}.jpg"
        paths = self._save_all_sizes(image, target)
        backup_full.unlink()
        # Going back to the photo throws the cut-out away, and with it both the
        # model's alpha and whatever the user painted on top of it: keeping them
        # would silently reappear on the next removal.
        stem = stem_of(target)
        for suffix in (AUTO_ALPHA_SUFFIX, EDIT_ALPHA_SUFFIX, BRUSH_SUFFIX):
            self._discard(f"{stem}{suffix}")
        return paths

    def delete_replaced(
        self, previous: Iterable[str | None], keeping: Iterable[str | None]
    ) -> None:
        """Bin the files a re-render left behind, once the new paths are committed.

        Called after the commit on purpose: a crash between writing the files and
        saving the paths must leave the item pointing at something that exists.
        """
        keep = {path for path in keeping if path}
        for path in previous:
            if not path or path in keep:
                continue
            full = self.storage_path / path
            try:
                full.unlink(missing_ok=True)
            except OSError:
                pass

    def rotate_image(
        self, image_path: str, direction: str = "cw", quarters: int = 1
    ) -> dict[str, str]:
        """Turn a stored image and rewrite its three sizes.

        ``quarters`` is how many 90° steps, so a user who tapped the button three
        times in a row costs one request and one re-encode rather than three of
        each. The turn itself is a transpose — no resampling, no quality lost —
        and the sidecar alpha channels are turned with it so an erased garment
        stays erased after straightening.

        Args:
            image_path: Relative path to the original image ("user_id/filename.jpg")
            direction: "cw" for clockwise, "ccw" for counter-clockwise
            quarters: number of 90° steps, 1-3 (0 is a no-op)
        """
        turns = (quarters if direction == "cw" else -quarters) % 4
        if turns == 0:
            # A whole turn is the identity. Answering without touching the disk is
            # what lets the client coalesce four taps into nothing at all.
            stem = stem_of(image_path)
            suffix = Path(image_path).suffix or ".jpg"
            return {
                "image_path": image_path,
                "medium_path": f"{stem}_medium{suffix}",
                "thumbnail_path": f"{stem}_thumb{suffix}",
            }

        original_full = self.storage_path / image_path
        if not original_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        if is_cutout_path(image_path):
            # A cut-out must stay a cut-out: flattening here would put the white box
            # back that the background removal just took away.
            with Image.open(original_full) as opened:
                image = opened.convert("RGBA")
        else:
            image = self._open_flat(original_full)
        rotated = rotate_quarters(image, turns)

        paths = self._save_all_sizes(rotated, image_path)
        self._rotate_sidecars(image_path, turns)
        return paths

    def _rotate_sidecars(self, image_path: str, turns: int) -> None:
        """Turn the stored alphas and the backup the same way as the garment.

        Without this, straightening a photo would silently undo an eraser edit: the
        alpha files are in the frame's coordinates, so a mask that is not turned with
        the image lands sideways the next time anything re-renders from it.
        """
        stem = stem_of(image_path)
        for suffix in (AUTO_ALPHA_SUFFIX, EDIT_ALPHA_SUFFIX, BRUSH_SUFFIX):
            path = self.storage_path / f"{stem}{suffix}"
            if not path.exists():
                continue
            with Image.open(path) as opened:
                turned = rotate_quarters(opened.copy(), turns)
            buffer = BytesIO()
            turned.save(buffer, format="PNG", optimize=True)
            path.write_bytes(buffer.getvalue())

        backup = self.storage_path / f"{stem}{BACKUP_SUFFIX}"
        if backup.exists():
            with Image.open(backup) as opened:
                turned = rotate_quarters(self._flatten_rgb(opened), turns)
            backup.write_bytes(self._encode_jpeg(turned, 95))
