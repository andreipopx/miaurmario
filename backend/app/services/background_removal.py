import logging
import threading
import time
from abc import ABC, abstractmethod
from io import BytesIO

import httpx
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)


class BackgroundRemovalProvider(ABC):
    @abstractmethod
    def remove(self, image: Image.Image) -> Image.Image:
        """Remove background from image. Returns RGBA image with transparent background."""


class RembgProvider(BackgroundRemovalProvider):
    """A local rembg model, with a second model to fall back on.

    The model is a file on disk — baked into the image at build time so a deploy
    never downloads 180 MB, and so removal works with no network at all. Which
    means a misspelt ``BG_REMOVAL_MODEL``, or a model the operator did not bake in,
    would otherwise leave the app with no cut-outs whatsoever. Falling back to
    ``fallback_model`` (u2net, always baked) keeps the feature working and says so
    loudly in the log, and ``model`` reports what is actually loaded rather than
    what was asked for.
    """

    def __init__(self, model: str = "u2net", fallback_model: str | None = None):
        self.requested_model = model
        self.fallback_model = fallback_model
        #: What is actually loaded. Equal to ``requested_model`` until a load fails.
        self.model = model
        self._session = None
        # Guards the one-time load so the startup warm-up and a first request never both
        # pay the ~40s rembg import + ONNX session creation.
        self._lock = threading.Lock()

    def _new_session(self, model: str):
        from rembg import new_session

        return new_session(model)

    def _get_session(self):
        if self._session is None:
            with self._lock:
                if self._session is None:
                    self._session = self._load()
        return self._session

    def _load(self):
        try:
            session = self._new_session(self.requested_model)
        except ImportError:
            # rembg itself is missing: nothing to fall back to, and the API turns
            # this into a 501 with installation instructions.
            raise
        except Exception:
            if not self.fallback_model or self.fallback_model == self.requested_model:
                raise
            logger.warning(
                "Background removal: model '%s' could not be loaded, falling back to '%s'. "
                "Bake it into the image (see BG_REMOVAL_MODEL in the README) to use it.",
                self.requested_model,
                self.fallback_model,
                exc_info=True,
            )
            session = self._new_session(self.fallback_model)
            self.model = self.fallback_model
        else:
            self.model = self.requested_model
        return session

    def warm_up(self) -> None:
        self._get_session()

    def remove(self, image: Image.Image) -> Image.Image:
        from rembg import remove

        return remove(image, session=self._get_session())


class HttpProvider(BackgroundRemovalProvider):
    def __init__(self, url: str, api_key: str | None = None):
        self.url = url.rstrip("/")
        self.api_key = api_key

    def remove(self, image: Image.Image) -> Image.Image:
        buf = BytesIO()
        image.save(buf, format="PNG")
        buf.seek(0)

        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        with httpx.Client(timeout=120, follow_redirects=True) as client:
            response = client.post(
                f"{self.url}/api/remove-background",
                files={"file": ("image.png", buf, "image/png")},
                headers=headers,
            )
            response.raise_for_status()

        return Image.open(BytesIO(response.content)).convert("RGBA")


_provider: BackgroundRemovalProvider | None = None


def get_provider() -> BackgroundRemovalProvider:
    global _provider
    if _provider is not None:
        return _provider

    settings = get_settings()
    provider_type = settings.bg_removal_provider

    if provider_type == "rembg":
        _provider = RembgProvider(
            model=settings.bg_removal_model,
            fallback_model=settings.bg_removal_fallback_model,
        )
    elif provider_type == "http":
        if not settings.bg_removal_url:
            raise ValueError("BG_REMOVAL_URL is required when BG_REMOVAL_PROVIDER=http")
        _provider = HttpProvider(url=settings.bg_removal_url, api_key=settings.bg_removal_api_key)
    else:
        raise ValueError(f"Unknown BG_REMOVAL_PROVIDER: {provider_type}. Use 'rembg' or 'http'.")

    return _provider


def _warm_up() -> None:
    started = time.monotonic()
    try:
        provider = get_provider()
        if isinstance(provider, RembgProvider):
            provider.warm_up()
            logger.info(
                "Background removal: rembg '%s' session ready in %.1fs",
                provider.model,
                time.monotonic() - started,
            )
    except ImportError:
        logger.info("Background removal: rembg not installed, skipping warm-up")
    except Exception:
        logger.warning("Background removal: warm-up failed", exc_info=True)


def start_warm_up() -> threading.Thread | None:
    """Load rembg + its model session in a daemon thread so the first removal after a
    deploy doesn't pay the cold import. Never blocks startup (or health checks)."""
    settings = get_settings()
    if not settings.bg_removal_preload or settings.bg_removal_provider != "rembg":
        return None
    logger.info(
        "Background removal: warming up rembg '%s' in the background", settings.bg_removal_model
    )
    thread = threading.Thread(target=_warm_up, name="rembg-warmup", daemon=True)
    thread.start()
    return thread
