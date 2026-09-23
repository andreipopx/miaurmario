"""The user's own taste, rendered as a Spanish block for the stylist prompts.

The recommendation and pairing prompts are shared by every user, so nothing
about a particular person's taste may live in the .txt templates. Instead the
services inject ``{style_profile_text}`` built here from the user's saved
preferences (the «Tu estilo con Stinky» swipe deck, colours, style sliders),
what the app learned from feedback and the body notes they chose to share.

Tag values stay in English in parentheses — the wardrobe list the model sees
uses them (e.g. ``navy``), so "azul marino (navy)" lets it match both ways.
"""

from collections.abc import Iterable, Mapping
from typing import Any

# Spanish display names for the colour tag vocabulary (tagger + manual picker).
COLOR_NAMES_ES: dict[str, str] = {
    "black": "negro",
    "charcoal": "gris marengo",
    "gray": "gris",
    "grey": "gris",
    "white": "blanco",
    "cream": "crudo",
    "beige": "beige",
    "tan": "camel",
    "khaki": "caqui",
    "olive": "verde oliva",
    "army-green": "verde militar",
    "green": "verde",
    "teal": "verde azulado",
    "navy": "azul marino",
    "blue": "azul",
    "light-blue": "azul claro",
    "brown": "marrón",
    "dark-brown": "marrón oscuro",
    "burgundy": "burdeos",
    "red": "rojo",
    "pink": "rosa",
    "purple": "morado",
    "yellow": "amarillo",
    "orange": "naranja",
    "gold": "dorado",
    "silver": "plateado",
}

STYLE_AXES_ES: dict[str, str] = {
    "casual": "casual",
    "formal": "formal / arreglado",
    "sporty": "deportivo",
    "minimalist": "minimalista",
    "bold": "atrevido / statement",
}

STYLE_TAGS_ES: dict[str, str] = {
    "casual": "casual",
    "classic": "clásico",
    "sporty": "deportivo",
    "minimalist": "minimalista",
    "bohemian": "bohemio",
    "preppy": "preppy",
    "streetwear": "streetwear",
    "elegant": "elegante",
    "athletic": "atlético",
    "vintage": "vintage",
    "modern": "moderno",
    "rugged": "rudo / workwear",
    "formal": "formal",
    "smart-casual": "smart casual",
}

LAYERING_ES = {"minimal": "pocas capas", "heavy": "le encantan las capas"}
VARIETY_ES = {"low": "poca (repite lo que funciona)", "high": "mucha (sorpréndele)"}

STRONG_STYLE_THRESHOLD = 60
WEAK_STYLE_THRESHOLD = 30

EMPTY_PROFILE_TEXT = (
    "Todavía no ha definido su perfil de estilo. Lee el armario como pista de su gusto: "
    "apuesta por combinaciones versátiles con un punto de personalidad."
)


def color_label_es(value: str) -> str:
    """ "navy" -> "azul marino (navy)"; unknown values are passed through."""
    key = (value or "").strip().lower()
    name = COLOR_NAMES_ES.get(key)
    return f"{name} ({key})" if name and name != key else key


def _colors(values: Iterable[str] | None) -> str:
    return ", ".join(color_label_es(v) for v in (values or []) if v)


def _style_tag(value: str) -> str:
    return STYLE_TAGS_ES.get(value, value)


def _get(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, Mapping):
        return obj.get(name)
    return getattr(obj, name, None)


def _body_notes(m: Mapping[str, Any] | None) -> str:
    if not m:
        return ""
    parts: list[str] = []
    for key, label, unit in (
        ("height", "altura", "cm"),
        ("weight", "peso", "kg"),
        ("chest", "pecho", "cm"),
        ("waist", "cintura", "cm"),
        ("hips", "cadera", "cm"),
        ("inseam", "entrepierna", "cm"),
    ):
        if m.get(key):
            parts.append(f"{label} {m[key]} {unit}")
    for key, label in (
        ("shirt_size", "talla de parte de arriba"),
        ("pants_size", "talla de pantalón"),
        ("dress_size", "talla de vestido"),
        ("shoe_size", "talla de calzado"),
    ):
        if m.get(key):
            parts.append(f"{label} {m[key]}")
    return ", ".join(parts)


def format_style_profile_for_prompt(
    preferences: Any = None,
    learned_prefs: Mapping[str, Any] | None = None,
    body_measurements: Mapping[str, Any] | None = None,
) -> str:
    """Spanish, gender-neutral bullet list of the user's taste.

    ``preferences`` is a ``UserPreference`` (or any object/dict with the same
    attribute names). Always returns text: an explicit "not set yet" line when
    the user has told us nothing, so the prompt never falls back to anybody
    else's taste.
    """
    # Imported here, not at module level: style_quiz reads COLOR_NAMES_ES from
    # this module, and the cycle would bite on import.
    from app.utils.style_quiz import quiz_prompt_lines

    # What they told Stinky in the swipe deck comes first: it is the most
    # explicit thing we have about their taste.
    lines: list[str] = list(quiz_prompt_lines(_get(preferences, "taste_profile")))

    favorites = _get(preferences, "color_favorites")
    if favorites:
        lines.append(f"- Colores favoritos: {_colors(favorites)}")
    avoid = _get(preferences, "color_avoid")
    if avoid:
        lines.append(f"- Colores que evita: {_colors(avoid)}")

    profile = _get(preferences, "style_profile") or {}
    if isinstance(profile, Mapping):
        numeric = [(k, v) for k, v in profile.items() if isinstance(v, (int, float))]
        strong = sorted(
            [(k, v) for k, v in numeric if v > STRONG_STYLE_THRESHOLD],
            key=lambda kv: kv[1],
            reverse=True,
        )
        weak = [k for k, v in numeric if v < WEAK_STYLE_THRESHOLD]
        if strong:
            desc = ", ".join(f"{STYLE_AXES_ES.get(k, k)} ({v}%)" for k, v in strong)
            lines.append(f"- Estilos que le representan: {desc}")
        if weak:
            desc = ", ".join(STYLE_AXES_ES.get(k, k) for k in weak)
            lines.append(f"- Estilos que no le van: {desc}")
        formal = profile.get("formal")
        if isinstance(formal, (int, float)):
            if formal >= 70:
                lines.append("- Formalidad: tiende a lo arreglado incluso en el día a día")
            elif formal <= 30:
                lines.append(
                    "- Formalidad: prefiere lo relajado; arregla solo si la ocasión lo pide"
                )

    layering = _get(preferences, "layering_preference")
    if layering in LAYERING_ES:
        lines.append(f"- Capas: {LAYERING_ES[layering]}")

    if learned_prefs:
        if learned_prefs.get("learned_favorite_colors"):
            lines.append(
                "- Colores que suele aceptar (aprendido de su feedback): "
                + _colors(learned_prefs["learned_favorite_colors"])
            )
        if learned_prefs.get("learned_avoid_colors"):
            lines.append(
                "- Colores que suele rechazar (aprendido de su feedback): "
                + _colors(learned_prefs["learned_avoid_colors"])
            )
        if learned_prefs.get("learned_preferred_styles"):
            styles = ", ".join(_style_tag(s) for s in learned_prefs["learned_preferred_styles"])
            lines.append(f"- Estilos que más acepta (aprendido): {styles}")

    body = _body_notes(body_measurements)
    if body:
        lines.append(
            f"- Notas de cuerpo que ha compartido: {body}. Úsalas para proporción y "
            "caída, nunca para juzgar ni comentar el cuerpo."
        )

    if not lines:
        return f"- {EMPTY_PROFILE_TEXT}"
    return "\n".join(lines)
