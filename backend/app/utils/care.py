"""Care-label vocabulary: fibres, composition text and short laundry hints.

Pure functions, no AI and no database — the same normalisation runs on what the
vision model read off a label photo and on what a user typed in by hand, so a
wardrobe without AI ends up with exactly the same structured data.

Fibre names are stored as English slugs (like colours and materials elsewhere in
the app) and localised in the frontend.
"""

from __future__ import annotations

import re
import unicodedata

MAX_FIBERS = 8

#: alias (accent-free, lowercase) -> stored fibre slug
FIBER_ALIASES: dict[str, str] = {
    "algodon": "cotton",
    "cotton": "cotton",
    "coton": "cotton",
    "baumwolle": "cotton",
    "poliester": "polyester",
    "polyester": "polyester",
    "poliestere": "polyester",
    "elastano": "elastane",
    "elastane": "elastane",
    "elastan": "elastane",
    "spandex": "elastane",
    "lycra": "elastane",
    "lana": "wool",
    "wool": "wool",
    "laine": "wool",
    "merino": "wool",
    "lana merino": "wool",
    "viscosa": "viscose",
    "viscose": "viscose",
    "rayon": "viscose",
    "rayon viscosa": "viscose",
    "lino": "linen",
    "linen": "linen",
    "lin": "linen",
    "seda": "silk",
    "silk": "silk",
    "soie": "silk",
    "poliamida": "polyamide",
    "polyamide": "polyamide",
    "nylon": "polyamide",
    "nilon": "polyamide",
    "acrilico": "acrylic",
    "acrylic": "acrylic",
    "acrilica": "acrylic",
    "cachemir": "cashmere",
    "cachemira": "cashmere",
    "cashmere": "cashmere",
    "cuero": "leather",
    "piel": "leather",
    "leather": "leather",
    "ante": "suede",
    "suede": "suede",
    "lyocell": "lyocell",
    "tencel": "lyocell",
    "modal": "modal",
    "canamo": "hemp",
    "hemp": "hemp",
    "yute": "jute",
    "bambu": "bamboo",
    "bamboo": "bamboo",
    "mohair": "mohair",
    "alpaca": "alpaca",
    "angora": "angora",
    "poliuretano": "polyurethane",
    "polyurethane": "polyurethane",
    "otras fibras": "other",
    "other fibres": "other",
    "otros": "other",
}

#: fibre slug -> the app's ``material`` vocabulary (``VALID_MATERIALS``)
FIBER_TO_MATERIAL: dict[str, str] = {
    "cotton": "cotton",
    "wool": "wool",
    "linen": "linen",
    "silk": "silk",
    "polyester": "polyester",
    "polyamide": "nylon",
    "leather": "leather",
    "suede": "suede",
}


def _strip_accents(text: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFD", text) if unicodedata.category(char) != "Mn"
    )


def normalize_fiber(name: str) -> str | None:
    """``"Algodón"`` -> ``"cotton"``; unknown fibres are kept as clean free text."""
    cleaned = re.sub(r"[^\w\s/-]", " ", (name or "").strip().lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None
    flat = _strip_accents(cleaned)
    if flat in FIBER_ALIASES:
        return FIBER_ALIASES[flat]
    for alias, slug in FIBER_ALIASES.items():
        if re.search(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", flat):
            return slug
    return cleaned[:40]


# A fibre name is anything that is not a separator, a digit or a percent sign,
# and it has to contain at least one letter — otherwise the whitespace before a
# percentage would match first and swallow the pair.
_FIBER_CHARS = r"[^,;/\d%]"
_FIBER_NAME = rf"{_FIBER_CHARS}*[^\W\d_]{_FIBER_CHARS}*"
_COMPOSITION_PART = re.compile(
    rf"(?P<pre>\d{{1,3}})\s*%\s*(?P<after>{_FIBER_NAME})"
    rf"|(?P<before>{_FIBER_CHARS}*[^\W\d_]{_FIBER_CHARS}*?)\s*(?P<post>\d{{1,3}})\s*%"
)


def parse_composition(text: str) -> list[dict]:
    """Parse ``"60% algodón, 40% poliéster"`` (either order) into fibre entries."""
    if not text:
        return []
    found: list[dict] = []
    seen: set[str] = set()
    for match in _COMPOSITION_PART.finditer(text.replace("\n", " ")):
        percent_raw = match.group("pre") or match.group("post")
        fiber_raw = match.group("after") or match.group("before") or ""
        fiber = normalize_fiber(fiber_raw)
        if not fiber or fiber in seen:
            continue
        try:
            percent = int(percent_raw)
        except (TypeError, ValueError):
            continue
        if not 0 < percent <= 100:
            continue
        seen.add(fiber)
        found.append({"fiber": fiber, "percent": percent})
        if len(found) >= MAX_FIBERS:
            break
    if found:
        return found

    # No percentages at all: "100% cotton" written as just "cotton".
    fiber = normalize_fiber(text)
    return [{"fiber": fiber, "percent": None}] if fiber else []


def dominant_material(composition: list[dict]) -> str | None:
    """The app-vocabulary material for the fibre with the largest share, if any."""
    ranked = sorted(
        (entry for entry in composition if entry.get("fiber")),
        key=lambda entry: entry.get("percent") or 0,
        reverse=True,
    )
    for entry in ranked:
        material = FIBER_TO_MATERIAL.get(str(entry["fiber"]))
        if material:
            return material
    return None


def care_hints(care: dict | None) -> list[str]:
    """Stable hint codes (``wash_30``, ``no_tumble``…) the frontend localises."""
    if not isinstance(care, dict):
        return []
    hints: list[str] = []
    wash = care.get("wash") or {}
    dry = care.get("dry") or {}
    iron = care.get("iron") or {}
    professional = care.get("professional") or {}

    if wash.get("do_not_wash"):
        hints.append("do_not_wash")
    elif wash.get("hand_wash"):
        hints.append("hand_wash")
    elif wash.get("max_temp_c"):
        hints.append(f"wash_{int(wash['max_temp_c'])}")
    elif wash.get("machine"):
        hints.append("machine_wash")
    if wash.get("cycle") in ("gentle", "delicate"):
        hints.append(f"cycle_{wash['cycle']}")
    if dry.get("tumble_dry") is False:
        hints.append("no_tumble")
    elif dry.get("tumble_dry") and dry.get("tumble_heat"):
        hints.append(f"tumble_{dry['tumble_heat']}")
    if dry.get("flat_dry"):
        hints.append("flat_dry")
    elif dry.get("line_dry"):
        hints.append("line_dry")
    if iron.get("allowed") is False:
        hints.append("no_iron")
    elif iron.get("max_temp_c"):
        hints.append(f"iron_{int(iron['max_temp_c'])}")
    if professional.get("dry_clean"):
        hints.append("dry_clean")
    elif professional.get("dry_clean") is False:
        hints.append("no_dry_clean")
    if care.get("bleach") == "none":
        hints.append("no_bleach")
    return hints


_HINT_TEXT = {
    "do_not_wash": "do not wash",
    "hand_wash": "hand wash",
    "machine_wash": "machine wash",
    "cycle_gentle": "gentle cycle",
    "cycle_delicate": "delicate cycle",
    "no_tumble": "no tumble dry",
    "tumble_low": "tumble dry low",
    "tumble_medium": "tumble dry medium",
    "tumble_high": "tumble dry high",
    "flat_dry": "dry flat",
    "line_dry": "line dry",
    "no_iron": "do not iron",
    "dry_clean": "dry clean",
    "no_dry_clean": "do not dry clean",
    "no_bleach": "no bleach",
}


def care_hint_text(care: dict | None, limit: int = 3) -> str | None:
    """A short human fragment for notification bodies, or None when unknown."""
    parts: list[str] = []
    for hint in care_hints(care):
        if hint.startswith("wash_"):
            parts.append(f"{hint.removeprefix('wash_')}°C")
        elif hint.startswith("iron_"):
            parts.append(f"iron {hint.removeprefix('iron_')}°C")
        else:
            parts.append(_HINT_TEXT.get(hint, hint.replace("_", " ")))
        if len(parts) >= limit:
            break
    return ", ".join(parts) or None
