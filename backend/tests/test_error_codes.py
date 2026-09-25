"""The suggestion/pairing paths must not leak English prose into the Spanish UI.

The contract: every user-visible failure answers with ``detail = {"code", "message"}``,
the ``code`` is registered in ``app.utils.error_codes.USER_FACING_ERROR_CODES``, and
both message catalogues have Spanish/English copy for it. The English ``message`` in
the body is for logs and non-browser clients; the app renders ``errors.api.<code>``.
"""

import json
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.models.item import ClothingItem, ItemStatus
from app.services.pairing_service import AIGenerationError, InsufficientItemsError
from app.services.recommendation_service import (
    AIRecommendationError,
    InsufficientWardrobeError,
)
from app.utils.error_codes import (
    USER_FACING_ERROR_CODES,
    CodedValueError,
    code_of,
    error_detail,
)
from app.utils.occasions import OCCASION_ES, VALID_OCCASIONS, occasion_label_es

MESSAGES_DIR = Path(__file__).resolve().parents[2] / "frontend" / "messages"

# Two or more English words in a row: enough to catch "Not enough items in wardrobe"
# without tripping on product names or slugs.
ENGLISH_GIVEAWAYS = re.compile(
    r"\b(not enough|please add|please try|please set|please check|could not|unable to|"
    r"wardrobe for|is not available|adjust filters|add more items|no location|"
    r"needs? washing|your outfit is ready|laundry reminder)\b",
    re.IGNORECASE,
)


def _messages(locale: str) -> dict:
    return json.loads((MESSAGES_DIR / f"{locale}.json").read_text(encoding="utf-8"))


class TestErrorCodeCatalogue:
    def test_error_detail_uses_the_registered_fallback(self):
        detail = error_detail("insufficient_wardrobe")
        assert detail["code"] == "insufficient_wardrobe"
        assert detail["message"] == USER_FACING_ERROR_CODES["insufficient_wardrobe"]

    def test_unknown_code_still_produces_a_body(self):
        assert error_detail("nonsense_code") == {
            "code": "nonsense_code",
            "message": "Request failed.",
        }

    def test_code_of_reads_the_exception_attribute(self):
        assert code_of(CodedValueError("boom", code="weather_unavailable"), "x") == (
            "weather_unavailable"
        )
        assert code_of(ValueError("boom"), "invalid_request") == "invalid_request"

    def test_domain_exceptions_carry_their_code(self):
        assert InsufficientWardrobeError.code == "insufficient_wardrobe"
        assert InsufficientItemsError.code == "insufficient_items_for_pairing"
        assert AIRecommendationError.code == "ai_recommendation_failed"
        assert AIGenerationError.code == "ai_pairing_failed"

    @pytest.mark.parametrize("locale", ["es", "en"])
    def test_every_code_has_copy_in_the_message_catalogue(self, locale):
        api_errors = _messages(locale)["errors"]["api"]
        missing = sorted(set(USER_FACING_ERROR_CODES) - set(api_errors))
        assert not missing, f"{locale}.json errors.api is missing: {missing}"
        for code, text in api_errors.items():
            assert text.strip(), f"{locale}.json errors.api.{code} is empty"

    def test_locales_stay_in_parity(self):
        assert set(_messages("es")["errors"]["api"]) == set(_messages("en")["errors"]["api"])

    def test_spanish_error_copy_is_not_english(self):
        for code, text in _messages("es")["errors"]["api"].items():
            assert not ENGLISH_GIVEAWAYS.search(text), f"es.json errors.api.{code} reads English"


class TestOccasionVocabulary:
    def test_every_api_occasion_has_a_spanish_label(self):
        assert set(OCCASION_ES) == VALID_OCCASIONS

    @pytest.mark.parametrize("locale", ["es", "en"])
    def test_every_api_occasion_is_translated(self, locale):
        messages = _messages(locale)
        for namespace in ("suggest", "tagValues"):
            labels = messages[namespace]["occasions"]
            missing = sorted(VALID_OCCASIONS - set(labels))
            assert not missing, f"{locale}.json {namespace}.occasions is missing: {missing}"

    def test_labels_the_owner_reported_are_spanish(self):
        labels = _messages("es")["suggest"]["occasions"]
        assert labels["wedding"] == "Boda"
        assert labels["brunch"] == "Brunch"
        assert labels["interview"] == "Entrevista"

    def test_unknown_slug_degrades_readably(self):
        assert occasion_label_es("garden-party") == "garden party"
        assert occasion_label_es(None) == "casual"


@pytest.fixture
def ai_allowed(monkeypatch):
    """Let the AI guard through so the wardrobe/weather checks are the ones that fire."""
    stub = object()

    async def _client(*_args, **_kwargs):
        return stub

    monkeypatch.setattr("app.services.recommendation_service.require_ai_client", _client)
    monkeypatch.setattr("app.services.pairing_service.require_ai_client", _client)
    return stub


class TestSuggestionPathSpeaksInCodes:
    """No English sentence may reach the client from /outfits/suggest or /pairings."""

    @staticmethod
    def _assert_coded(payload: dict) -> str:
        detail = payload["detail"]
        assert isinstance(detail, dict), f"detail must be a code object, got {detail!r}"
        code = detail["code"]
        assert code in USER_FACING_ERROR_CODES, f"unregistered code {code!r}"
        assert _messages("es")["errors"]["api"][code]
        return code

    @staticmethod
    async def _add_items(db_session, user, types=("shirt", "pants", "sneakers")):
        for item_type in types:
            db_session.add(
                ClothingItem(
                    user_id=user.id,
                    type=item_type,
                    image_path=f"test/{uuid4()}.jpg",
                    status=ItemStatus.ready,
                    primary_color="blue",
                )
            )
        await db_session.commit()

    @pytest.mark.asyncio
    async def test_empty_wardrobe_returns_a_code_not_prose(
        self, client, test_user, auth_headers, ai_allowed
    ):
        response = await client.post(
            "/api/v1/outfits/suggest",
            json={
                "occasion": "casual",
                "weather_override": {"temperature": 20, "condition": "clear"},
            },
            headers=auth_headers,
        )
        assert response.status_code == 400, response.text
        assert self._assert_coded(response.json()) == "insufficient_wardrobe"
        # The exact leak the owner reported after pressing "suggest".
        assert "Not enough items in wardrobe" not in response.text
        assert "adjust filters" not in response.text

    @pytest.mark.asyncio
    async def test_missing_location_returns_a_code_not_prose(
        self, client, test_user, auth_headers, db_session, ai_allowed
    ):
        await self._add_items(db_session, test_user)
        # No weather_override, and test_user has no location: the weather lookup fails.
        response = await client.post(
            "/api/v1/outfits/suggest", json={"occasion": "casual"}, headers=auth_headers
        )
        assert response.status_code == 400, response.text
        assert self._assert_coded(response.json()) == "location_not_set"
        assert "Please set location in settings" not in response.text

    @pytest.mark.asyncio
    async def test_ai_failure_returns_a_code_not_the_model_output(
        self, client, test_user, auth_headers
    ):
        with patch(
            "app.api.outfits.RecommendationService.generate_recommendation",
            new_callable=AsyncMock,
            side_effect=AIRecommendationError(
                "Could not parse AI response as JSON: {'oops': 'raw model text'}"
            ),
        ):
            response = await client.post(
                "/api/v1/outfits/suggest",
                json={
                    "occasion": "casual",
                    "weather_override": {"temperature": 20, "condition": "clear"},
                },
                headers=auth_headers,
            )
        assert response.status_code == 503, response.text
        assert self._assert_coded(response.json()) == "ai_recommendation_failed"
        assert "raw model text" not in response.text

    @pytest.mark.asyncio
    async def test_pairings_return_a_code_not_prose(
        self, client, test_user, auth_headers, ai_allowed
    ):
        response = await client.post(
            f"/api/v1/pairings/generate/{uuid4()}",
            json={"num_pairings": 3},
            headers=auth_headers,
        )
        assert response.status_code == 400, response.text
        code = self._assert_coded(response.json())
        assert code in {"insufficient_items_for_pairing", "pairing_source_not_found"}
        assert "Not enough items in wardrobe" not in response.text
        assert "Source item not found" not in response.text

    @pytest.mark.asyncio
    async def test_no_english_sentence_in_the_suggest_error_body(
        self, client, test_user, auth_headers, ai_allowed
    ):
        response = await client.post(
            "/api/v1/outfits/suggest",
            json={
                "occasion": "casual",
                "weather_override": {"temperature": 20, "condition": "clear"},
            },
            headers=auth_headers,
        )
        code = response.json()["detail"]["code"]
        # The registered English fallback is the one string API clients may read; nothing
        # else in the body may look like a sentence written for a person.
        body = response.text.replace(USER_FACING_ERROR_CODES[code], "")
        assert not ENGLISH_GIVEAWAYS.search(body), body
