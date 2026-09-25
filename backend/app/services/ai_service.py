import base64
import io
import json
import logging
import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from dataclasses import field as dc_field
from pathlib import Path
from typing import Any, Literal

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel

from app.config import get_settings
from app.utils.prompts import load_prompt

logger = logging.getLogger(__name__)


class TextGenerationResult(BaseModel):
    content: str
    model: str
    endpoint: str


class ClothingTags(BaseModel):
    type: str = "unknown"
    subtype: str | None = None
    primary_color: str | None = None
    colors: list[str] = []
    pattern: str | None = None
    material: str | None = None
    style: list[str] = []
    formality: str | None = None
    season: list[str] = []
    fit: str | None = None
    occasion: list[str] = []
    brand: str | None = None
    condition: str | None = None
    features: list[str] = []
    confidence: float = 0.0
    logprobs_confidence: float | None = None
    description: str | None = None
    raw_response: str | None = None


TAGGING_PROMPT = load_prompt("clothing_analysis")
DESCRIPTION_PROMPT = load_prompt("clothing_description")
CARE_LABEL_PROMPT = load_prompt("care_label")

# Valid values for validation
VALID_TYPES = {
    "shirt",
    "t-shirt",
    "pants",
    "jeans",
    "shorts",
    "dress",
    "skirt",
    "jacket",
    "coat",
    "sweater",
    "hoodie",
    "blazer",
    "vest",
    "cardigan",
    "polo",
    "blouse",
    "tank-top",
    "shoes",
    "sneakers",
    "boots",
    "sandals",
    "hat",
    "scarf",
    "belt",
    "bag",
    "accessories",
    "top",
    "jumpsuit",
    "socks",
    "tie",
}
VALID_COLORS = {
    "black",
    "white",
    "gray",
    "navy",
    "blue",
    "light-blue",
    "red",
    "burgundy",
    "pink",
    "green",
    "olive",
    "yellow",
    "orange",
    "purple",
    "brown",
    "tan",
    "beige",
    "cream",
    "gold",
    "silver",
}
VALID_PATTERNS = {
    "solid",
    "striped",
    "plaid",
    "checkered",
    "floral",
    "graphic",
    "geometric",
    "polka-dot",
    "camouflage",
    "animal-print",
}
VALID_MATERIALS = {
    "cotton",
    "denim",
    "leather",
    "wool",
    "polyester",
    "silk",
    "linen",
    "knit",
    "fleece",
    "suede",
    "velvet",
    "nylon",
    "canvas",
}
VALID_FORMALITY = {"very-casual", "casual", "smart-casual", "business-casual", "formal"}
VALID_FIT = {"slim", "regular", "relaxed", "oversized", "tailored", "cropped"}
VALID_STYLES = {
    "casual",
    "classic",
    "sporty",
    "minimalist",
    "bohemian",
    "preppy",
    "streetwear",
    "elegant",
    "athletic",
    "vintage",
    "modern",
    "rugged",
}
VALID_SEASONS = {"spring", "summer", "fall", "winter", "all-season"}


def compute_tag_completeness(tags: "ClothingTags") -> float:
    score = 0.0
    if tags.type and tags.type != "unknown":
        score += 0.25
    if tags.primary_color:
        score += 0.20
    if tags.pattern:
        score += 0.15
    if tags.formality:
        score += 0.15
    if tags.material:
        score += 0.10
    if tags.season:
        score += 0.05
    if tags.style:
        score += 0.05
    if tags.colors:
        score += 0.05
    return round(score, 2)


_CONFIDENCE_FIELDS = {"type", "primary_color", "pattern", "material", "formality"}


def compute_confidence_from_logprobs(logprobs_content: list[dict] | None) -> float | None:
    if not logprobs_content:
        return None

    field_probs: dict[str, list[float]] = {}
    current_key = None
    expect_value = False

    for entry in logprobs_content:
        token = entry.get("token", "")
        logprob = entry.get("logprob", 0)
        prob = math.exp(logprob)
        stripped = token.strip().strip('"').strip("'")

        if stripped in _CONFIDENCE_FIELDS:
            current_key = stripped
            expect_value = False
            continue

        if current_key and ":" in token:
            expect_value = True
            continue

        if expect_value and current_key and stripped and stripped not in ("{", "[", ",", "}", "]"):
            if stripped == "null":
                current_key = None
                expect_value = False
                continue
            if current_key not in field_probs:
                field_probs[current_key] = []
            field_probs[current_key].append(prob)
            current_key = None
            expect_value = False

    if not field_probs:
        return None

    weights = {
        "type": 0.30,
        "primary_color": 0.25,
        "pattern": 0.15,
        "material": 0.15,
        "formality": 0.15,
    }
    total_weight = 0.0
    weighted_sum = 0.0

    for field, probs in field_probs.items():
        w = weights.get(field, 0.1)
        weighted_sum += w * min(probs)
        total_weight += w

    if total_weight == 0:
        return None

    return round(weighted_sum / total_weight, 2)


class AIEndpointConfig:
    """Configuration for an AI endpoint."""

    def __init__(
        self,
        url: str,
        vision_model: str | None = "moondream",
        text_model: str | None = "phi3:mini",
        name: str = "default",
        enabled: bool = True,
        api_key: str | None = None,
        follow_redirects: bool = True,
    ):
        self.url = url.rstrip("/") if url else url
        self.vision_model = vision_model
        self.text_model = text_model
        self.name = name
        self.enabled = enabled
        self.api_key = api_key
        self.follow_redirects = follow_redirects


@dataclass(frozen=True)
class AIProviderConfig:
    """A single OpenAI-compatible provider (platform env config or a user's BYOK).

    ``api_key`` is a secret: never log it or include it in repr/errors.
    """

    base_url: str
    api_key: str | None = dc_field(default=None, repr=False)
    vision_model: str | None = None
    text_model: str | None = None
    name: str = "default"
    # BYOK endpoints must not follow redirects (a 30x to a LAN address would
    # bypass the SSRF check done on the configured host).
    follow_redirects: bool = True

    @classmethod
    def platform(cls) -> "AIProviderConfig":
        s = get_settings()
        return cls(
            base_url=s.ai_base_url,
            api_key=s.ai_api_key,
            vision_model=s.ai_vision_model,
            text_model=s.ai_text_model,
            name="default",
        )


# sink(requests, total_tokens, prompt_tokens=0, completion_tokens=0)
UsageSink = Callable[..., Awaitable[None]]


def _as_token_count(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


class AIService:
    """Service for AI-powered image analysis and text generation.

    One instance talks to exactly one provider: the platform key (default) or a
    user's own key (``config``). Callers should obtain instances through
    ``app.services.ai_access`` so per-user access rules and usage accounting
    apply; constructing ``AIService()`` directly uses the platform key.
    """

    def __init__(
        self,
        config: AIProviderConfig | None = None,
        usage_sink: UsageSink | None = None,
    ):
        """
        Raises:
            AIDisabledError: backstop when internal AI is disabled; call sites
                should guard with require_internal_ai() first.
        """
        self.settings = get_settings()
        if not self.settings.ai_enabled:
            raise AIDisabledError("Internal AI is disabled; defer to an external agent.")
        self.timeout = self.settings.ai_timeout
        cfg = config or AIProviderConfig.platform()
        self.config = cfg
        self.api_key = cfg.api_key
        self._usage_sink = usage_sink

        self._endpoints: list[AIEndpointConfig] = [
            AIEndpointConfig(
                url=cfg.base_url,
                vision_model=cfg.vision_model,
                text_model=cfg.text_model,
                name=cfg.name,
                api_key=cfg.api_key,
                follow_redirects=cfg.follow_redirects,
            )
        ]

        # Legacy properties for backwards compatibility
        self.base_url = self._endpoints[0].url
        self.vision_model = self._endpoints[0].vision_model
        self.text_model = self._endpoints[0].text_model

    def _get_headers(self, endpoint: AIEndpointConfig | None = None) -> dict:
        """Get headers for AI API requests, including auth if configured."""
        headers = {"Content-Type": "application/json"}
        api_key = endpoint.api_key if endpoint is not None else self.api_key
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    async def _record_usage(self, data: dict) -> None:
        """Report one successful completion (+ tokens when the provider sends them)."""
        if self._usage_sink is None:
            return
        tokens = prompt = completion = 0
        usage = data.get("usage") if isinstance(data, dict) else None
        if isinstance(usage, dict):
            prompt = _as_token_count(usage.get("prompt_tokens"))
            completion = _as_token_count(usage.get("completion_tokens"))
            total = usage.get("total_tokens")
            tokens = total if isinstance(total, int) else prompt + completion
        try:
            await self._usage_sink(
                1, max(tokens, 0), prompt_tokens=prompt, completion_tokens=completion
            )
        except Exception as e:  # accounting must never break the AI call
            logger.warning(f"Failed to record AI usage: {type(e).__name__}")

    @staticmethod
    def _extract_content(data: dict, endpoint_name: str) -> tuple[str, dict]:
        """Return (content, choice) or raise AIResponseError for empty/truncated output.

        Reasoning models (e.g. DeepSeek) can spend the whole max_tokens budget on
        reasoning and return ``content`` empty/null with finish_reason "length";
        surface that as a clear error instead of a JSON-parse crash downstream.
        """
        try:
            choice = data["choices"][0]
        except (KeyError, IndexError, TypeError):
            raise AIResponseError(
                f"AI provider '{endpoint_name}' returned no choices", reason="no_choices"
            ) from None
        message = choice.get("message") or {}
        content = message.get("content")
        if isinstance(content, list):  # some providers return content parts
            content = "".join(
                p.get("text", "") for p in content if isinstance(p, dict) and p.get("text")
            )
        content = content or ""
        if not content.strip():
            finish_reason = choice.get("finish_reason")
            if finish_reason == "length":
                raise AIResponseError(
                    "The AI model ran out of tokens before answering (finish_reason=length). "
                    "Increase AI_MAX_TOKENS or use a non-reasoning model.",
                    reason="truncated",
                )
            raise AIResponseError(
                f"The AI model returned an empty response (finish_reason={finish_reason})",
                reason="empty",
            )
        return content, choice

    def _preprocess_image(self, image_path: str | Path) -> str:
        """
        Preprocess image for AI analysis.
        Returns base64-encoded JPEG string.
        """
        with Image.open(image_path) as img:
            # A cut-out is RGBA and its transparent pixels are black underneath, so
            # a plain convert("RGB") would hand the model a garment on a black
            # background. Composite onto white — the model was prompted for photos.
            if img.mode in ("RGBA", "LA", "P", "PA"):
                rgba = img.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (255, 255, 255))
                flat.paste(rgba, mask=rgba.getchannel("A"))
                img = flat
            elif img.mode != "RGB":
                img = img.convert("RGB")

            # Auto-orient based on EXIF
            img = ImageOps.exif_transpose(img)

            # Resize to max 512x512 for faster AI processing
            max_size = 512
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            # Convert to JPEG bytes
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85)
            buffer.seek(0)

            return base64.b64encode(buffer.read()).decode("utf-8")

    def _parse_tags_from_response(self, response_text: str) -> ClothingTags:
        def extract_json(text: str) -> dict | None:
            try:
                return json.loads(text.strip())
            except json.JSONDecodeError:
                pass

            json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
            if json_match:
                try:
                    return json.loads(json_match.group(1))
                except json.JSONDecodeError:
                    pass

            start_idx = text.find("{")
            if start_idx != -1:
                brace_count = 0
                for i, char in enumerate(text[start_idx:], start_idx):
                    if char == "{":
                        brace_count += 1
                    elif char == "}":
                        brace_count -= 1
                        if brace_count == 0:
                            json_str = text[start_idx : i + 1]
                            try:
                                return json.loads(json_str)
                            except json.JSONDecodeError:
                                break
            return None

        COLOR_ALIASES: dict[str, str] = {
            "grey": "gray",
            "light grey": "gray",
            "light gray": "gray",
            "dark grey": "gray",
            "dark gray": "gray",
            "off-white": "cream",
            "ivory": "cream",
            "wine": "burgundy",
            "maroon": "burgundy",
            "forest green": "green",
            "dark blue": "navy",
            "royal blue": "blue",
            "sky blue": "light-blue",
            "baby blue": "light-blue",
            "camel": "tan",
            "khaki": "tan",
            "rust": "orange",
            "coral": "pink",
            "rose": "pink",
            "mauve": "purple",
            "lavender": "purple",
            "mustard": "yellow",
            "gold": "yellow",
            "silver": "gray",
            "charcoal": "gray",
        }

        def as_list(value: Any) -> list:
            """A list, whatever shape the model answered with.

            The prompt asks for ``"style": ["casual"]``, and a model that answers
            ``"style": "casual"`` is not wrong about the garment — only about the
            JSON. Read as a one-element list the tag survives; iterated as a string
            it becomes its own characters and every one of them is thrown away.
            """
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                return [value] if value.strip() else []
            return []

        def as_scalar(value: Any) -> str | None:
            """The single value a field wants, out of whatever arrived.

            The mirror image of ``as_list``: a model that wraps a scalar in a list
            (``"formality": ["casual"]``) meant the value inside it.
            """
            if isinstance(value, str):
                return value
            if isinstance(value, list):
                for entry in value:
                    if isinstance(entry, str):
                        return entry
            return None

        def validate_value(value: Any, valid_set: set) -> str | None:
            text = as_scalar(value)
            if text is None:
                return None
            value_lower = text.lower().strip()
            if value_lower in valid_set:
                return value_lower
            alias = COLOR_ALIASES.get(value_lower)
            if alias and alias in valid_set:
                return alias
            return None

        def validate_list(values: Any, valid_set: set) -> list:
            return [
                v.lower().strip()
                for v in as_list(values)
                if isinstance(v, str) and v.lower().strip() in valid_set
            ]

        data = extract_json(response_text)
        if not data:
            logger.warning(f"Could not parse JSON from AI response: {response_text[:200]}")
            return ClothingTags(raw_response=response_text)

        if isinstance(data, list):
            data = data[0] if data and isinstance(data[0], dict) else {}

        tags = ClothingTags()
        tags.raw_response = response_text

        item_type = validate_value(data.get("type"), VALID_TYPES)
        if item_type:
            tags.type = item_type
        else:
            tags.type = "unknown"

        tags.subtype = as_scalar(data.get("subtype")) or None
        tags.primary_color = validate_value(data.get("primary_color"), VALID_COLORS)
        tags.colors = validate_list(data.get("colors", []), VALID_COLORS)
        tags.pattern = validate_value(data.get("pattern"), VALID_PATTERNS)
        tags.material = validate_value(data.get("material"), VALID_MATERIALS)
        tags.formality = validate_value(data.get("formality"), VALID_FORMALITY)
        tags.style = validate_list(data.get("style", []), VALID_STYLES)
        tags.season = validate_list(data.get("season", []), VALID_SEASONS)
        tags.fit = validate_value(data.get("fit"), VALID_FIT)
        tags.confidence = compute_tag_completeness(tags)

        logger.info(
            f"Parsed tags: type={tags.type}, color={tags.primary_color}, pattern={tags.pattern}"
        )
        return tags

    async def _call_with_fallback(
        self,
        messages: list,
        task_name: str,
        use_vision_model: bool = True,
        request_logprobs: bool = False,
    ) -> tuple[str | None, Exception | None, list | None]:
        last_error: Exception | None = None

        for endpoint in self._endpoints:
            logger.info(f"Trying AI endpoint for {task_name}: {endpoint.name}")
            model = endpoint.vision_model if use_vision_model else endpoint.text_model
            if not model:
                last_error = AIResponseError(
                    f"No {'vision' if use_vision_model else 'text'} model configured",
                    reason="no_model",
                )
                continue

            async with httpx.AsyncClient(
                timeout=self.timeout, follow_redirects=endpoint.follow_redirects
            ) as client:
                for attempt in range(self.settings.ai_max_retries):
                    try:
                        request_body = {
                            "model": model,
                            "messages": messages,
                            "stream": False,
                            "max_tokens": self.settings.ai_max_tokens,
                        }
                        if request_logprobs:
                            request_body["logprobs"] = True
                            request_body["top_logprobs"] = 3

                        response = await client.post(
                            f"{endpoint.url}/chat/completions",
                            headers=self._get_headers(endpoint),
                            json=request_body,
                        )
                        response.raise_for_status()

                        data = response.json()
                        await self._record_usage(data)
                        content, choice = self._extract_content(data, endpoint.name)
                        logprobs_content = None
                        if request_logprobs:
                            lp = choice.get("logprobs")
                            if lp:
                                logprobs_content = lp.get("content")

                        used_model = data.get("model", model)
                        logger.info(
                            f"AI {task_name} successful via {endpoint.name} (model: {used_model})"
                        )
                        return content, None, logprobs_content

                    except AIResponseError as e:
                        # Deterministic model-side failure: retrying burns tokens for nothing.
                        last_error = e
                        logger.warning(f"AI {task_name} via {endpoint.name}: {e}")
                        break
                    except httpx.HTTPStatusError as e:
                        last_error = e
                        logger.warning(f"HTTP error from {endpoint.name}: {e.response.status_code}")
                        if attempt < self.settings.ai_max_retries - 1:
                            continue
                    except httpx.RequestError as e:
                        last_error = e
                        logger.warning(f"Request error from {endpoint.name}: {type(e).__name__}")
                        if attempt < self.settings.ai_max_retries - 1:
                            continue

        return None, last_error, None

    async def analyze_image(self, image_path: str | Path) -> ClothingTags:
        image_base64 = self._preprocess_image(image_path)

        # System/user separation for injection protection
        messages_tags = [
            {"role": "system", "content": TAGGING_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            },
        ]

        messages_desc = [
            {"role": "system", "content": DESCRIPTION_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            },
        ]

        tags = ClothingTags()
        last_error = None

        # First pass: structured tags with logprobs for real confidence
        content, err, logprobs_content = await self._call_with_fallback(
            messages_tags, "tags", request_logprobs=True
        )
        if content:
            tags = self._parse_tags_from_response(content)
            logprobs_confidence = compute_confidence_from_logprobs(logprobs_content)
            if logprobs_confidence is not None:
                tags.logprobs_confidence = logprobs_confidence
        if err:
            last_error = err

        # Second pass: human-readable description
        content, err, _ = await self._call_with_fallback(messages_desc, "description")
        if content:
            description = content.strip()
            if description.startswith('"') and description.endswith('"'):
                description = description[1:-1]
            tags.description = description

        if tags.type == "unknown" and not tags.description and last_error:
            raise last_error

        return tags

    async def analyze_vision_json(
        self, image_base64: str, system_prompt: str, task_name: str = "vision"
    ) -> str:
        """Run one vision call with a caller-supplied prompt; return the raw content.

        For features whose answer is not the single-garment tagging schema (the
        selfie garment list, for example). Parsing/validation is the caller's,
        so each feature owns its own contract.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            },
        ]
        content, err, _ = await self._call_with_fallback(messages, task_name)
        if content:
            return content
        if err:
            raise err
        raise AIResponseError(f"AI {task_name} returned no content", reason="empty")

    async def analyze_care_label(self, image_path: str | Path) -> str | None:
        """Read a care-label photo and return the model's raw JSON answer.

        Parsing lives in ``app.services.care_label`` so the same validation runs
        on hand-typed care data. Returns None when no endpoint answered.
        """
        image_base64 = self._preprocess_image(image_path)
        messages = [
            {"role": "system", "content": CARE_LABEL_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            },
        ]
        content, error, _ = await self._call_with_fallback(messages, "care-label")
        if content:
            return content
        if error:
            raise error
        return None

    async def check_health(self) -> dict:
        """Check health of all configured AI endpoints."""
        endpoints_health = []

        for endpoint in self._endpoints:
            try:
                async with httpx.AsyncClient(
                    timeout=5, follow_redirects=endpoint.follow_redirects
                ) as client:
                    # Try OpenAI-compatible /v1/models endpoint first
                    response = await client.get(
                        f"{endpoint.url}/models", headers=self._get_headers(endpoint)
                    )
                    if response.status_code == 200:
                        data = response.json()
                        # OpenAI format: {"data": [{"id": "model-name", ...}]}
                        models = data.get("data", [])
                        model_names = [m.get("id", "") for m in models]
                        endpoints_health.append(
                            {
                                "name": endpoint.name,
                                "url": endpoint.url,
                                "status": "healthy",
                                "vision_model": endpoint.vision_model,
                                "text_model": endpoint.text_model,
                                "available_models": model_names,
                            }
                        )
                        continue

                    # Fallback: Try Ollama-specific endpoint
                    response = await client.get(endpoint.url.replace("/v1", "/api/tags"))
                    if response.status_code == 200:
                        models = response.json().get("models", [])
                        model_names = [m.get("name", "") for m in models]
                        endpoints_health.append(
                            {
                                "name": endpoint.name,
                                "url": endpoint.url,
                                "status": "healthy",
                                "vision_model": endpoint.vision_model,
                                "text_model": endpoint.text_model,
                                "available_models": model_names,
                            }
                        )
                    else:
                        endpoints_health.append(
                            {
                                "name": endpoint.name,
                                "url": endpoint.url,
                                "status": "unhealthy",
                                "error": f"HTTP {response.status_code}",
                            }
                        )
            except Exception as e:
                endpoints_health.append(
                    {
                        "name": endpoint.name,
                        "url": endpoint.url,
                        "status": "unhealthy",
                        "error": str(e),
                    }
                )

        # Overall status is healthy if at least one endpoint is healthy
        any_healthy = any(ep["status"] == "healthy" for ep in endpoints_health)
        return {
            "status": "healthy" if any_healthy else "unhealthy",
            "endpoints": endpoints_health,
        }

    async def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        return_metadata: bool = False,
    ) -> str | TextGenerationResult:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        last_error: Exception | None = None

        for endpoint in self._endpoints:
            if not endpoint.text_model:
                last_error = AIResponseError("No text model configured", reason="no_model")
                continue
            logger.info(f"Trying text generation via {endpoint.name}")

            async with httpx.AsyncClient(
                timeout=self.timeout, follow_redirects=endpoint.follow_redirects
            ) as client:
                for attempt in range(self.settings.ai_max_retries):
                    try:
                        response = await client.post(
                            f"{endpoint.url}/chat/completions",
                            headers=self._get_headers(endpoint),
                            json={
                                "model": endpoint.text_model,
                                "messages": messages,
                                "stream": False,
                                "temperature": 0.4,
                                "max_tokens": self.settings.ai_max_tokens,
                            },
                        )
                        response.raise_for_status()

                        data = response.json()
                        await self._record_usage(data)
                        used_model = data.get("model", endpoint.text_model)
                        content, _ = self._extract_content(data, endpoint.name)
                        logger.info(
                            f"Text generation successful via {endpoint.name} (model: {used_model})"
                        )

                        if return_metadata:
                            return TextGenerationResult(
                                content=content,
                                model=used_model,
                                endpoint=endpoint.name,
                            )
                        return content

                    except AIResponseError as e:
                        last_error = e
                        logger.warning(f"Text generation via {endpoint.name}: {e}")
                        break
                    except httpx.HTTPStatusError as e:
                        last_error = e
                        logger.warning(f"HTTP error from {endpoint.name}: {e.response.status_code}")
                        if attempt < self.settings.ai_max_retries - 1:
                            continue
                    except httpx.RequestError as e:
                        last_error = e
                        logger.warning(f"Request error from {endpoint.name}: {type(e).__name__}")
                        if attempt < self.settings.ai_max_retries - 1:
                            continue

        if last_error:
            raise last_error
        raise RuntimeError("Failed to generate text - no endpoints available")


class AIResponseError(RuntimeError):
    """The provider answered, but the answer is unusable (empty, truncated, no choices)."""

    def __init__(self, message: str, reason: str = "invalid"):
        super().__init__(message)
        self.reason = reason


class AIDisabledError(RuntimeError):
    """Raised when an internal AI client is requested while that capability is off."""


def require_internal_ai(capability: Literal["vision", "text"]) -> None:
    """Raise AIDisabledError if the given internal-AI capability is disabled.

    Call before constructing AIService directly so deferred work never builds a
    client or reaches a provider.
    """
    settings = get_settings()
    enabled = (
        settings.effective_ai_vision_enabled
        if capability == "vision"
        else settings.effective_ai_text_enabled
    )
    if not enabled:
        raise AIDisabledError(
            f"Internal AI {capability} is disabled "
            f"(AI_INTERNAL_ENABLED / AI_{capability.upper()}_ENABLED=false). "
            "Defer this work to an external agent."
        )


# Singleton instance
_ai_service: AIService | None = None


def get_ai_service() -> AIService:
    """Return the shared AIService, or raise AIDisabledError if internal AI is off."""
    if not get_settings().ai_enabled:
        raise AIDisabledError("Internal AI is disabled; defer to an external agent.")
    global _ai_service
    if _ai_service is None:
        _ai_service = AIService()
    return _ai_service
