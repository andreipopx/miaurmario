"""Turn a care-label photo into structured care data.

The vision model is asked for JSON (``app/prompts/care_label.txt``); everything
it answers is treated as untrusted and re-validated through
:class:`app.schemas.item.CareInfo`, so a hallucinated field is dropped rather
than stored. Users without AI never reach this module — they type the same
structure into the form by hand.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import ValidationError

from app.schemas.item import CareInfo

logger = logging.getLogger(__name__)

#: Dots on a wash tub / iron, for models that count dots instead of reading °C.
WASH_DOTS = {1: 30, 2: 40, 3: 50, 4: 60, 5: 70, 6: 95}
IRON_DOTS = {1: 110, 2: 150, 3: 200}


def extract_json_object(text: str) -> dict | None:
    """Pull the first JSON object out of a model answer (fences and all)."""
    if not text:
        return None
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", candidate, re.S)
    if fenced:
        candidate = fenced.group(1).strip()
    try:
        data = json.loads(candidate)
    except (ValueError, TypeError):
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            data = json.loads(candidate[start : end + 1])
        except (ValueError, TypeError):
            return None
    return data if isinstance(data, dict) else None


def _as_temperature(value: Any, dots: dict[int, int]) -> Any:
    """Accept 30 / "30°C" / 1 dot and land on degrees Celsius."""
    if isinstance(value, str):
        match = re.search(r"\d{1,3}", value)
        value = int(match.group(0)) if match else None
    if isinstance(value, int | float):
        number = int(value)
        return dots.get(number, number) if number <= 6 else number
    return value


def _normalize_payload(data: dict) -> dict:
    """Straighten out the shapes models tend to answer with."""
    payload = {key: value for key, value in data.items() if value is not None}

    wash = payload.get("wash")
    if isinstance(wash, dict):
        wash = dict(wash)
        if "max_temp_c" in wash:
            wash["max_temp_c"] = _as_temperature(wash.get("max_temp_c"), WASH_DOTS)
        if isinstance(wash.get("cycle"), str):
            wash["cycle"] = wash["cycle"].strip().lower()
        payload["wash"] = wash

    iron = payload.get("iron")
    if isinstance(iron, dict):
        iron = dict(iron)
        if "max_temp_c" in iron:
            iron["max_temp_c"] = _as_temperature(iron.get("max_temp_c"), IRON_DOTS)
        payload["iron"] = iron

    dry = payload.get("dry")
    if isinstance(dry, dict):
        dry = dict(dry)
        if isinstance(dry.get("tumble_heat"), str):
            dry["tumble_heat"] = dry["tumble_heat"].strip().lower()
        payload["dry"] = dry

    bleach = payload.get("bleach")
    if isinstance(bleach, bool):
        payload["bleach"] = "any" if bleach else "none"
    elif isinstance(bleach, str):
        payload["bleach"] = bleach.strip().lower().replace("-", "_")

    if isinstance(payload.get("notes"), str):
        payload["notes"] = payload["notes"].strip()[:500] or None

    payload.pop("source", None)
    return payload


def parse_care_label(text: str) -> CareInfo:
    """Parse a model answer into :class:`CareInfo`; an unreadable one is empty."""
    data = extract_json_object(text or "")
    if not data:
        return CareInfo(source="ai")
    payload = _normalize_payload(data)
    try:
        return CareInfo.model_validate({**payload, "source": "ai"})
    except ValidationError as exc:
        logger.info("Care label answer failed validation: %s", exc.error_count())
        # Keep whatever individual sections do validate rather than losing the lot.
        salvaged: dict[str, Any] = {"source": "ai"}
        for key in ("composition", "wash", "bleach", "dry", "iron", "professional", "notes"):
            if key not in payload:
                continue
            try:
                CareInfo.model_validate({key: payload[key]})
            except ValidationError:
                continue
            salvaged[key] = payload[key]
        try:
            return CareInfo.model_validate(salvaged)
        except ValidationError:
            return CareInfo(source="ai")
