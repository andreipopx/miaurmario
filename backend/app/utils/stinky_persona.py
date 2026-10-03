"""Each person's own Stinky: the name and coat they gave the stylist cat.

The cat is "Stinky", a tuxedo, until the person renames him or picks another
coat (Ajustes → Tu Stinky). Every prompt that speaks as the cat and every text
we send in his name (push, email) goes through here, so the chat, the looks
and the notifications all call him what the person calls him.

Coats match the pre-rendered asset sets the app serves (see
frontend/components/stinky/stinky-coats.ts); the ids must stay in sync.
"""

from __future__ import annotations

import re
from typing import Any

DEFAULT_NAME = "Stinky"
DEFAULT_COAT = "esmoquin"
NAME_MAX_LENGTH = 20

#: Coat id -> how the cat looks (eyes apart, see below).
COAT_LOOKS: dict[str, str] = {
    "esmoquin": "esmoquin (blanco y negro, nariz rosa)",
    "naranja-atigrado": "naranja atigrado (rayas canela, hocico crema)",
    "naranja-blanco": "naranja y blanco (pecho y hocico blancos)",
    "negro": "negro (todo negro)",
    "blanco": "blanco",
    "gris": "gris azulado (pelo liso)",
    "atigrado": "atigrado marrón (rayas oscuras)",
    "atigrado-gris": "atigrado gris (rayas negras)",
    "siames": "siamés (cara y orejas oscuras)",
    "calico": "calicó (blanco con manchas naranjas y negras)",
}
COATS = tuple(COAT_LOOKS)

#: Each coat's own eyes, as they read after "un gato <look>".
NATURAL_EYES: dict[str, str] = {
    "esmoquin": "de ojos ámbar",
    "naranja-atigrado": "de ojos dorados",
    "naranja-blanco": "de ojos dorados",
    "negro": "de ojos amarillos",
    "blanco": "con un ojo azul y otro dorado",
    "gris": "de ojos cobre",
    "atigrado": "de ojos verdes",
    "atigrado-gris": "de ojos verdes",
    "siames": "de ojos azules",
    "calico": "de ojos dorados",
}

#: Eye colours that can replace a coat's own ("natural" keeps them).
DEFAULT_EYES = "natural"
EYES: dict[str, str] = {
    "ambar": "de ojos ámbar",
    "verde": "de ojos verdes",
    "azul": "de ojos azules",
    "cobre": "de ojos cobre",
}


def describe(coat: str, eyes: str = DEFAULT_EYES) -> str:
    """ "un gato naranja atigrado (…) de ojos verdes": how the cat describes himself."""
    look = COAT_LOOKS.get(coat, COAT_LOOKS[DEFAULT_COAT])
    eye_text = EYES.get(eyes) or NATURAL_EYES.get(coat, NATURAL_EYES[DEFAULT_COAT])
    return f"un gato {look} {eye_text}"


# Letters of any script, digits, spaces and a little punctuation (Mª, O'Malley,
# Don Gato, Chan-Chan). Nothing a prompt could read as an instruction.
_NAME_RE = re.compile(r"^[^\W_](?:[\w '’.·-]*[^\W_])?$")

# The shipped prompts describe the default cat in two ways; both become the
# person's coat (and their name, below).
_COAT_PHRASES = (
    "un gato esmoquin (blanco y negro, nariz rosa, ojos ámbar)",
    "el gato esmoquin",
)
_STINKY_WORD = re.compile(r"\bStinky\b")


def clean_name(value: str | None) -> str | None:
    """Normalise a requested name; None/blank means "back to Stinky".

    Raises ValueError("invalid_stinky_name") for anything that isn't a short,
    plain name.
    """
    if value is None:
        return None
    name = " ".join(value.split())
    if not name or name == DEFAULT_NAME:
        return None
    if len(name) > NAME_MAX_LENGTH or not _NAME_RE.match(name):
        raise ValueError("invalid_stinky_name")
    return name


def clean_coat(value: str | None) -> str | None:
    """None/the default coat both store as None."""
    if value is None or value == DEFAULT_COAT:
        return None
    if value not in COAT_LOOKS:
        raise ValueError("invalid_stinky_coat")
    return value


def clean_eyes(value: str | None) -> str | None:
    """None/"natural" (the coat's own eyes) both store as None."""
    if value is None or value == DEFAULT_EYES:
        return None
    if value not in EYES:
        raise ValueError("invalid_stinky_eyes")
    return value


def stinky_name(user: Any) -> str:
    return getattr(user, "stinky_name", None) or DEFAULT_NAME


def stinky_coat(user: Any) -> str:
    coat = getattr(user, "stinky_coat", None)
    return coat if coat in COAT_LOOKS else DEFAULT_COAT


def stinky_eyes(user: Any) -> str:
    eyes = getattr(user, "stinky_eyes", None)
    return eyes if eyes in EYES else DEFAULT_EYES


def personalize(text: str, user: Any) -> str:
    """Rewrite a prompt or message written for the default Stinky for this person's cat."""
    coat, eyes = stinky_coat(user), stinky_eyes(user)
    if (coat, eyes) != (DEFAULT_COAT, DEFAULT_EYES):
        description = describe(coat, eyes)
        for phrase in _COAT_PHRASES:
            replacement = description if phrase.startswith("un ") else "el " + description[3:]
            text = text.replace(phrase, replacement)
    name = stinky_name(user)
    if name != DEFAULT_NAME:
        text = _STINKY_WORD.sub(lambda _: name, text)
    return text
