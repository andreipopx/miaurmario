"""The occasion vocabulary, and the Spanish labels for backend-composed copy.

The slug is the wire format: it is what the AI prompts use, what the DB stores and
what the API accepts. The app UI translates slugs itself (``messages/{es,en}.json``
→ ``suggest.occasions.<slug>``); :data:`OCCASION_ES` exists only for the strings the
backend has to write out on its own, i.e. push and email notification copy.

``backend/tests/test_i18n_coverage.py`` checks that every slug here has a label in
both message files and in :data:`OCCASION_ES`.
"""

from __future__ import annotations

import unicodedata

VALID_OCCASIONS = {
    "casual",
    "office",
    "work",
    "formal",
    "smart-casual",
    "business-casual",
    "date",
    "party",
    "sporty",
    "sport",
    "outdoor",
    "travel",
    "lounge",
    "beach",
    "interview",
    "wedding",
    "dinner",
    "brunch",
    "gym",
    "running",
    "hiking",
    "weekend",
}

# Lowercase: these go inside a sentence ("un look de oficina").
OCCASION_ES = {
    "casual": "casual",
    "office": "oficina",
    "work": "trabajo",
    "formal": "formal",
    "smart-casual": "casual arreglado",
    "business-casual": "oficina relajada",
    "date": "cita",
    "party": "fiesta",
    "sporty": "deportivo",
    "sport": "deporte",
    "outdoor": "aire libre",
    "travel": "viaje",
    "lounge": "casa",
    "beach": "playa",
    "interview": "entrevista",
    "wedding": "boda",
    "dinner": "cena",
    "brunch": "brunch",
    "gym": "gimnasio",
    "running": "correr",
    "hiking": "monte",
    "weekend": "finde",
}


def occasion_label_es(occasion: str | None) -> str:
    """Spanish label for an occasion slug; unknown slugs come back readable."""
    if not occasion:
        return OCCASION_ES["casual"]
    slug = occasion.strip().lower()
    return OCCASION_ES.get(slug, slug.replace("_", " ").replace("-", " "))


def ascii_fold(text: str) -> str:
    """Drop accents so a string is safe in an HTTP header (ntfy titles)."""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
