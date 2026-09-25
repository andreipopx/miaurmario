"""Machine-readable error codes for the failures a user actually sees.

The UI is Spanish-first, so the backend never sends user-facing prose: it sends
``{"code": ..., "message": ...}`` as the HTTP ``detail``. The frontend looks the
code up in ``frontend/messages/{es,en}.json`` under ``errors.api.<code>``; the
English ``message`` is only a fallback for non-browser API clients and for logs.

Keep :data:`USER_FACING_ERROR_CODES` in sync with that ``errors.api`` namespace —
``backend/tests/test_error_codes.py`` and ``frontend/tests/i18n.test.ts`` both
check it.
"""

from __future__ import annotations

# code -> English fallback message (never rendered in the app UI).
USER_FACING_ERROR_CODES: dict[str, str] = {
    # Generic
    "invalid_request": "The request could not be processed.",
    # Outfit suggestion / day moments
    "insufficient_wardrobe": "Not enough items in the wardrobe to build an outfit.",
    "location_not_set": "No location set for this account.",
    "location_unresolved": "The saved location could not be resolved.",
    "weather_unavailable": "Weather data is unavailable right now.",
    # Items
    "item_not_found": "That garment is not in this wardrobe.",
    # Pairings
    "insufficient_items_for_pairing": "Not enough items in the wardrobe to build pairings.",
    "pairing_source_not_found": "The item to pair is not available.",
    # AI
    "ai_internal_disabled": "Internal AI is disabled; this is deferred to an external agent.",
    "ai_recommendation_failed": "The AI could not produce an outfit suggestion.",
    "ai_pairing_failed": "The AI could not produce pairings.",
}


def error_detail(code: str, message: str | None = None) -> dict[str, str]:
    """Body for ``HTTPException(detail=...)``: a code the UI translates.

    ``message`` defaults to the English fallback registered for ``code``; pass one
    explicitly only for codes that are not user-facing.
    """
    return {
        "code": code,
        "message": message or USER_FACING_ERROR_CODES.get(code, "Request failed."),
    }


class CodedValueError(ValueError):
    """A ``ValueError`` that carries the error code the UI should show.

    Services raise these so the API layer can map them without matching on
    English prose. ``str(e)`` stays English, for the logs.
    """

    code = "invalid_request"

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        if code:
            self.code = code


def code_of(error: Exception, default: str) -> str:
    """The ``code`` attribute of ``error``, or ``default``."""
    code = getattr(error, "code", None)
    return code if isinstance(code, str) and code else default
