import shutil
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path

import imagehash
from PIL import Image, ImageOps

from app.config import get_settings
from app.services import background_removal
from app.utils.image_formats import CUTOUT_SUFFIX, is_cutout_path

settings = get_settings()

__all__ = [
    "CUTOUT_SUFFIX",
    "CropBox",
    "ImageService",
    "is_cutout_path",
    "strip_metadata",
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


def _encode(image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    image.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


def _encode_alpha(image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    image.save(output, format="WEBP", quality=quality, method=6)
    return output.getvalue()


def trim_transparent(image: Image.Image, padding: float = 0.02) -> Image.Image:
    """Crop away a fully transparent border, leaving a small breathing margin.

    A cut-out inherits the framing of the photo it came from, which usually means
    a garment adrift in a sea of nothing. Trimming lets the tile show the garment
    rather than the space around it. Guarded: a bounding box that swallows most of
    the picture is a bad mask, not a tight crop, so the image is left alone.
    """
    if image.mode != "RGBA":
        return image
    box = image.getchannel("A").getbbox()
    if box is None:
        return image
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    if width * height < 0.05 * image.width * image.height:
        return image
    pad = int(round(max(width, height) * padding))
    return image.crop(
        (
            max(0, left - pad),
            max(0, top - pad),
            min(image.width, right + pad),
            min(image.height, bottom + pad),
        )
    )


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
    """Turn the image by ``quarters`` * 90 degrees clockwise (negative: anticlockwise)."""
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
        ext = Path(original_filename).suffix.lower()
        if ext in (".heic", ".heif"):
            image = self._convert_heic(image_data)
        else:
            image = Image.open(BytesIO(image_data))
        return apply_crop(rotate_quarters(upright(image), rotate), crop)

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
        image = self.load_upload(image_data, original_filename, rotate=rotate, crop=crop)

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
        """Delete all image files for an item."""
        for path in paths.values():
            if path:
                full_path = self.storage_path / path
                if full_path.exists():
                    full_path.unlink()

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
        base_path = image_path.rsplit(".", 1)[0]
        original_full = self.storage_path / image_path

        if not original_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        backup_path = f"{base_path}_orig.jpg"
        backup_full = self.storage_path / backup_path
        # First removal wins: a second removal must not overwrite the true
        # original with an already-processed image
        if not backup_full.exists():
            if is_cutout_path(image_path):
                # Nothing to back up losslessly: flatten the cut-out we have.
                backup_full.write_bytes(self._encode_jpeg(Image.open(original_full), 95))
            else:
                shutil.copy2(original_full, backup_full)

        image = self._flatten_rgb(Image.open(original_full))
        provider = background_removal.get_provider()
        result = provider.remove(image)

        if bg_color is not None:
            paths = self._save_all_sizes(self.composite_on(result, bg_color), f"{base_path}.jpg")
        else:
            paths = self._save_all_sizes(
                trim_transparent(result.convert("RGBA")), f"{base_path}{CUTOUT_SUFFIX}"
            )
        paths["original_backup_path"] = backup_path
        return paths

    def restore_original(self, image_path: str, backup_path: str) -> dict[str, str]:
        """Put the untouched photo back, under the .jpg names it originally had."""
        backup_full = self.storage_path / backup_path
        if not backup_full.exists():
            raise ValueError(f"Backup not found: {backup_path}")

        image = Image.open(backup_full).convert("RGB")
        # The backup is named after the original, so it says where to restore to —
        # `image_path` may by now be the .webp cut-out we are throwing away.
        if backup_path.endswith("_orig.jpg"):
            target = f"{backup_path[: -len('_orig.jpg')]}.jpg"
        else:
            target = f"{image_path.rsplit('.', 1)[0]}.jpg"
        paths = self._save_all_sizes(image, target)
        backup_full.unlink()
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

    def rotate_image(self, image_path: str, direction: str = "cw") -> dict[str, str]:
        """
        Rotate an image and regenerate all sizes.

        Args:
            image_path: Relative path to the original image (e.g., "user_id/filename.jpg")
            direction: "cw" for clockwise 90°, "ccw" for counter-clockwise 90°

        Returns:
            dict with updated paths (same as input since we overwrite)
        """
        original_full = self.storage_path / image_path

        if not original_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        angle = -90 if direction == "cw" else 90  # PIL rotates counter-clockwise by default

        image = Image.open(original_full)
        # A cut-out must stay a cut-out: flattening here would put the white box
        # back that the background removal just took away.
        if is_cutout_path(image_path):
            image = image.convert("RGBA")
        else:
            image = self._flatten_rgb(image)
        rotated = image.rotate(angle, expand=True)

        return self._save_all_sizes(rotated, image_path)
