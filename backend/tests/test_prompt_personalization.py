"""Prompts are shared by every user: no hardcoded taste, neutral Spanish,
and each user's own style profile injected at format time."""

from types import SimpleNamespace

import pytest

from app.utils.prompts import load_prompt
from app.utils.style_profile import (
    EMPTY_PROFILE_TEXT,
    color_label_es,
    format_style_profile_for_prompt,
)

HARDCODED_TASTE = ["Iris van Herpen", "Vivienne Westwood", "clienta", "Tu clienta"]


def _prefs(**overrides):
    base = {
        "color_favorites": [],
        "color_avoid": [],
        "style_profile": {},
        "layering_preference": "moderate",
        "variety_level": "moderate",
        "temperature_sensitivity": "normal",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class TestRecommendationPrompt:
    def test_no_hardcoded_person_or_gender(self):
        prompt = load_prompt("recommendation")
        for needle in HARDCODED_TASTE:
            assert needle not in prompt

    def test_has_style_profile_placeholder_and_voice(self):
        prompt = load_prompt("recommendation")
        assert "{style_profile_text}" in prompt
        assert "Stinky" in prompt
        assert "tú, no usted" in prompt

    def test_format_injects_profile(self):
        from app.services.recommendation_service import RECOMMENDATION_PROMPT

        profile = format_style_profile_for_prompt(
            _prefs(color_favorites=["navy"], style_profile={"bold": 90})
        )
        formatted = RECOMMENDATION_PROMPT.format(
            occasion="casual",
            time_of_day="morning",
            temperature=18,
            feels_like=17,
            condition="clear",
            precipitation_chance=0,
            preferences_text="",
            style_profile_text=profile,
            items_text="[1] shirt | navy",
            mandatory_items_section="",
            song_context_text="",
        )
        assert "azul marino (navy)" in formatted
        assert "atrevido" in formatted
        assert "{" not in formatted.split("FORMATO DE RESPUESTA")[0]


class TestPairingPrompt:
    def _format(self, profile: str = "- x") -> str:
        from app.services.pairing_service import PAIRING_PROMPT_TEMPLATE

        return PAIRING_PROMPT_TEMPLATE.format(
            style_profile_text=profile,
            source_number=1,
            source_description="navy blazer",
            items_text="[2] white t-shirt",
            num_pairings=3,
        )

    def test_spanish_and_personalised(self):
        prompt = load_prompt("item_pairing")
        assert "{style_profile_text}" in prompt
        assert "You are" not in prompt
        assert "español" in prompt
        for needle in HARDCODED_TASTE:
            assert needle not in prompt

    def test_keeps_json_contract(self):
        formatted = self._format()
        for key in ('"items"', '"headline"', '"highlights"', '"styling_tip"'):
            assert key in formatted
        assert "[1] navy blazer" in formatted
        assert "Crea 3 looks" in formatted

    @pytest.mark.asyncio
    async def test_generate_pairings_injects_user_profile(
        self, db_session, test_user_with_preferences, monkeypatch
    ):
        from app.services.pairing_service import PairingService

        service = PairingService(db_session)
        text = await service._style_profile_text(test_user_with_preferences)
        assert "negro (black)" in text
        assert "naranja (orange)" in text


class TestTaggingPrompts:
    def test_analysis_keeps_english_enums_and_valid_json_example(self):
        import json

        prompt = load_prompt("clothing_analysis")
        assert "never translate" in prompt
        assert "light-blue" in prompt and "smart-casual" in prompt
        # The prompt is sent raw (not str.format'ed), so the example must be real JSON.
        example = prompt.strip().splitlines()[-1]
        parsed = json.loads(example)
        assert set(parsed) >= {"type", "primary_color", "colors", "pattern", "formality"}

    def test_description_is_spanish(self):
        prompt = load_prompt("clothing_description")
        assert "en español" in prompt


class TestStyleProfileFormatter:
    def test_empty_profile_is_explicit(self):
        assert EMPTY_PROFILE_TEXT in format_style_profile_for_prompt(None)
        assert EMPTY_PROFILE_TEXT in format_style_profile_for_prompt(_prefs())

    def test_colors_styles_and_formality(self):
        text = format_style_profile_for_prompt(
            _prefs(
                color_favorites=["tan", "burgundy"],
                color_avoid=["orange"],
                style_profile={"casual": 20, "formal": 80, "minimalist": 70, "bold": 50},
                layering_preference="heavy",
            )
        )
        assert "Colores favoritos: camel (tan), burdeos (burgundy)" in text
        assert "Colores que evita: naranja (orange)" in text
        assert "formal / arreglado (80%)" in text
        assert "minimalista (70%)" in text
        assert "Estilos que no le van: casual" in text
        assert "tiende a lo arreglado" in text
        assert "le encantan las capas" in text

    def test_learned_and_body_notes(self):
        text = format_style_profile_for_prompt(
            None,
            learned_prefs={
                "learned_favorite_colors": ["navy"],
                "learned_avoid_colors": ["yellow"],
                "learned_preferred_styles": ["vintage", "minimalist"],
            },
            body_measurements={"height": 170, "shoe_size": "39"},
        )
        assert "azul marino (navy)" in text
        assert "amarillo (yellow)" in text
        assert "vintage, minimalista" in text
        assert "altura 170 cm" in text
        assert "talla de calzado 39" in text
        assert "nunca para juzgar" in text

    def test_dict_preferences_supported(self):
        text = format_style_profile_for_prompt({"color_favorites": ["black"]})
        assert "negro (black)" in text

    def test_color_label_unknown_passthrough(self):
        assert color_label_es("chartreuse") == "chartreuse"
        assert color_label_es("beige") == "beige"
        assert color_label_es("Navy") == "azul marino (navy)"
