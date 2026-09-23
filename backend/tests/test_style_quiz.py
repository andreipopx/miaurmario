"""«Tu estilo con Stinky»: the swipe deck's vocabulary, endpoints and effects."""

from datetime import date, datetime
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.models.item import ClothingItem
from app.models.preference import UserPreference
from app.services.item_scorer import _preference_score, score_items
from app.services.weather_service import WeatherData
from app.utils.style_profile import STYLE_TAGS_ES, format_style_profile_for_prompt
from app.utils.style_quiz import (
    GARMENT_PREFS,
    MAX_CHIP_LENGTH,
    MAX_CHIPS,
    QUIZ_VERSION,
    STYLE_CARD_IDS,
    STYLE_CARDS,
    STYLE_CARDS_BY_ID,
    empty_quiz,
    is_answered,
    normalize_quiz,
    quiz_bias,
    quiz_prompt_lines,
    quiz_summary_lines,
    stamp_now,
)

FRONTEND_CARDS = (
    Path(__file__).resolve().parents[2] / "frontend" / "lib" / "style-quiz" / "cards.ts"
)

BODY_WORDS = ("favorec", "figura", "cuerpo", "peso", "delgad", "gord", "talla")


class TestCatalogue:
    def test_deck_is_short_enough_to_finish(self):
        assert 15 <= len(STYLE_CARDS) <= 20

    def test_ids_are_unique_and_url_safe(self):
        assert len(set(STYLE_CARD_IDS)) == len(STYLE_CARD_IDS)
        assert all(c.id.replace("-", "").isalnum() for c in STYLE_CARDS)

    def test_style_tags_come_from_the_shared_vocabulary(self):
        for card in STYLE_CARDS:
            for tag in card.styles:
                assert tag in STYLE_TAGS_ES, f"{card.id} uses unknown style tag {tag}"

    def test_every_category_is_represented(self):
        categories = {c.category for c in STYLE_CARDS}
        assert categories == {"aesthetic", "silhouette", "palette"}

    def test_labels_never_talk_about_the_person(self):
        for card in STYLE_CARDS:
            assert not any(w in card.label_es.casefold() for w in BODY_WORDS)

    @pytest.mark.skipif(
        not FRONTEND_CARDS.is_file(),
        reason="no frontend checkout next to the backend (backend-only image/CI job)",
    )
    def test_frontend_deck_matches_the_backend_catalogue(self):
        """The copy lives in the frontend; the meaning here. Ids must agree."""
        source = FRONTEND_CARDS.read_text(encoding="utf-8")
        for card in STYLE_CARDS:
            assert f"'{card.id}'" in source, f"{card.id} missing from cards.ts"


class TestNormalize:
    def test_empty(self):
        assert normalize_quiz(None) == empty_quiz()
        assert normalize_quiz({}) == empty_quiz()
        assert not is_answered(None)

    def test_drops_unknown_cards_and_keeps_catalogue_order(self):
        quiz = normalize_quiz({"liked": ["boho", "not-a-card", "minimal"]})
        assert quiz["liked"] == ["minimal", "boho"]

    def test_a_card_cannot_be_liked_and_disliked(self):
        quiz = normalize_quiz({"liked": ["minimal"], "disliked": ["minimal", "boho"]})
        assert quiz["liked"] == ["minimal"]
        assert quiz["disliked"] == ["boho"]

    def test_chips_are_trimmed_deduped_and_capped(self):
        quiz = normalize_quiz(
            {
                "brands": ["  Acne  ", "acne", "", "x" * 200, *[f"b{i}" for i in range(30)]],
            }
        )
        assert quiz["brands"][0] == "Acne"
        assert "acne" not in quiz["brands"][1:]
        assert len(quiz["brands"]) == MAX_CHIPS
        assert all(len(b) <= MAX_CHIP_LENGTH for b in quiz["brands"])

    def test_unknown_fit_is_dropped(self):
        assert normalize_quiz({"fit": "elegante"})["fit"] is None
        assert normalize_quiz({"fit": "holgado"})["fit"] == "holgado"

    def test_survives_garbage(self):
        assert normalize_quiz({"liked": "minimal", "brands": 7, "completed": "yes"}) == {
            **empty_quiz(),
            "completed": True,
        }

    def test_client_cannot_forge_the_save_date(self):
        assert normalize_quiz({"updated_at": 12345})["updated_at"] is None
        stamped = stamp_now({"liked": ["minimal"], "updated_at": "1999-01-01T00:00:00+00:00"})
        assert stamped["updated_at"] > "2020"
        assert stamped["version"] == QUIZ_VERSION

    def test_answered_once_anything_is_set(self):
        assert is_answered({"occasions": ["oficina"]})
        assert not is_answered({"completed": True})


class TestSummaryAndPrompt:
    QUIZ = {
        "liked": ["minimal", "tailored"],
        "disliked": ["boho"],
        "brands": ["Lemaire"],
        "never_wear": ["tacones"],
        "colors_avoid": ["amarillo"],
        "occasions": ["oficina"],
        "fit": "holgado",
    }

    def test_prompt_lines_mention_every_answer(self):
        text = "\n".join(quiz_prompt_lines(self.QUIZ))
        for expected in ("minimalismo limpio", "sastrería", "bohemio", "Lemaire", "tacones"):
            assert expected in text
        assert text.startswith("- ")

    def test_summary_is_plain_spanish_about_taste_only(self):
        lines = quiz_summary_lines(self.QUIZ)
        assert lines and all(line.endswith(".") for line in lines)
        joined = " ".join(lines).casefold()
        assert not any(w in joined for w in BODY_WORDS)

    def test_nothing_answered_says_nothing(self):
        assert quiz_prompt_lines(None) == []
        assert quiz_summary_lines({}) == []

    def test_quiz_reaches_the_stylist_prompt(self):
        prefs = UserPreference(taste_profile=self.QUIZ)
        text = format_style_profile_for_prompt(prefs)
        assert "minimalismo limpio" in text
        assert "tacones" in text


class TestGarmentPreference:
    """«¿Qué ropa quieres que te proponga?» — about clothes, never about who.

    It is asked, never inferred, and an unanswered one has to leave every
    prompt exactly as it was before the question existed.
    """

    BASE = {"liked": ["minimal"], "fit": "holgado"}

    def test_unanswered_is_the_default_and_changes_nothing(self):
        assert empty_quiz()["garment_pref"] is None
        assert normalize_quiz({})["garment_pref"] is None
        assert quiz_prompt_lines(self.BASE) == quiz_prompt_lines(
            {**self.BASE, "garment_pref": None}
        )

    @pytest.mark.parametrize("value", ["ambas", "sin_decir"])
    def test_ambas_and_a_refusal_behave_exactly_like_unanswered(self, value):
        """The whole point: nothing downstream may tell these three apart."""
        assert quiz_prompt_lines({**self.BASE, "garment_pref": value}) == quiz_prompt_lines(
            self.BASE
        )
        prefs = UserPreference(taste_profile={**self.BASE, "garment_pref": value})
        plain = UserPreference(taste_profile=self.BASE)
        assert format_style_profile_for_prompt(prefs) == format_style_profile_for_prompt(plain)

    @pytest.mark.parametrize("value,word", [("masculina", "camisa"), ("femenina", "blusa")])
    def test_an_answer_adds_one_line_about_garment_words(self, value, word):
        base = quiz_prompt_lines(self.BASE)
        lines = quiz_prompt_lines({**self.BASE, "garment_pref": value})
        assert len(lines) == len(base) + 1
        added = next(line for line in lines if line not in base)
        assert value in added
        # It steers the vocabulary and what to suggest, not anything about them.
        assert word in added
        assert "no digas nada sobre la persona" in added

    def test_it_reaches_the_stylist_prompt(self):
        prefs = UserPreference(taste_profile={**self.BASE, "garment_pref": "femenina"})
        assert "sección femenina" in format_style_profile_for_prompt(prefs)

    def test_the_summary_reads_it_back_but_never_a_refusal(self):
        assert "sección masculina" in " ".join(
            quiz_summary_lines({**self.BASE, "garment_pref": "masculina"})
        )
        assert quiz_summary_lines({**self.BASE, "garment_pref": "sin_decir"}) == quiz_summary_lines(
            self.BASE
        )

    def test_garbage_is_dropped_rather_than_rejected(self):
        for junk in ("hombre", "", None, 7, ["femenina"]):
            assert normalize_quiz({"garment_pref": junk})["garment_pref"] is None
        for value in GARMENT_PREFS:
            assert normalize_quiz({"garment_pref": value})["garment_pref"] == value

    def test_it_counts_as_having_answered(self):
        assert is_answered({"garment_pref": "ambas"})
        assert not is_answered({"garment_pref": "not-an-option"})

    def test_it_never_talks_about_the_person(self):
        from app.utils.style_quiz import GARMENT_PREF_PROMPT_ES, GARMENT_PREF_SUMMARY_ES

        for line in (*GARMENT_PREF_PROMPT_ES.values(), *GARMENT_PREF_SUMMARY_ES.values()):
            assert not any(w in line.casefold() for w in BODY_WORDS)
            for banned in ("hombre", "mujer", "género", "sexo", "chico", "chica"):
                assert banned not in line.casefold(), line


class TestHabitualSizes:
    """Sizes live with the measurements, not in the quiz: one place knows them."""

    def test_the_quiz_never_stores_a_size(self):
        assert not [k for k in empty_quiz() if "size" in k or "talla" in k]
        stored = normalize_quiz({"shirt_size": "M", "sizes": {"top": "M"}})
        assert "shirt_size" not in stored and "sizes" not in stored

    def test_sizes_reach_the_prompt_from_the_measurements(self):
        text = format_style_profile_for_prompt(
            None, body_measurements={"shirt_size": "M", "pants_size": "40", "shoe_size": "42"}
        )
        assert "talla de parte de arriba M" in text
        assert "talla de pantalón 40" in text
        assert "talla de calzado 42" in text
        # They are for telling the user what to look for, never a comment.
        assert "nunca para juzgar" in text

    def test_no_sizes_saved_means_no_line(self):
        assert "talla" not in format_style_profile_for_prompt(None, body_measurements={})

    def test_the_removed_inseam_field_is_not_reintroduced(self):
        """It was dropped from the form on purpose; nothing may ask for it again."""
        assert "inseam" not in empty_quiz()


class TestBias:
    def test_untouched_deck_has_no_bias(self):
        assert not quiz_bias(None)
        assert not quiz_bias({"completed": True})

    def test_liked_cards_map_to_styles_and_colours(self):
        bias = quiz_bias({"liked": ["minimal", "jewel"]})
        assert "minimalist" in bias.liked_styles
        assert "burgundy" in bias.liked_colors

    def test_a_liked_tag_is_never_also_penalised(self):
        # streetwear and utility both carry "casual".
        bias = quiz_bias({"liked": ["streetwear"], "disliked": ["utility"]})
        assert "casual" in bias.liked_styles
        assert "casual" not in bias.disliked_styles
        assert "rugged" in bias.disliked_styles

    def test_free_text_colours_match_the_vocabulary(self):
        bias = quiz_bias({"colors_avoid": ["amarillo chillón", "no sé"]})
        assert "yellow" in bias.avoided_colors

    def test_liked_palette_wins_over_an_avoid_chip(self):
        bias = quiz_bias({"liked": ["brights"], "colors_avoid": ["rojo"]})
        assert "red" not in bias.avoided_colors


def _item(**kw) -> ClothingItem:
    return ClothingItem(name=kw.pop("name", "x"), **kw)


def _mild_weather() -> WeatherData:
    return WeatherData(
        temperature=18,
        feels_like=18,
        humidity=50,
        precipitation_chance=0,
        precipitation_mm=0,
        wind_speed=10,
        condition="clear",
        condition_code=0,
        is_day=True,
        uv_index=5,
        timestamp=datetime(2026, 9, 23, 12, 0),
    )


class TestNonAIScoring:
    def test_liked_style_beats_disliked_style(self):
        prefs = UserPreference(taste_profile={"liked": ["minimal"], "disliked": ["boho"]})
        liked = _item(style=["minimalist", "modern"], primary_color="black")
        disliked = _item(style=["bohemian"], primary_color="black")
        assert _preference_score(liked, prefs, None, quiz_bias(prefs.taste_profile)) > (
            _preference_score(disliked, prefs, None, quiz_bias(prefs.taste_profile))
        )

    def test_avoided_colour_is_demoted(self):
        prefs = UserPreference(taste_profile={"colors_avoid": ["amarillo"]})
        bias = quiz_bias(prefs.taste_profile)
        yellow = _item(primary_color="yellow", colors=["yellow"])
        navy = _item(primary_color="navy", colors=["navy"])
        assert _preference_score(yellow, prefs, None, bias) < _preference_score(
            navy, prefs, None, bias
        )

    def test_no_quiz_means_no_change(self):
        prefs = UserPreference(taste_profile={})
        item = _item(style=["minimalist"], primary_color="black")
        assert _preference_score(item, prefs, None, quiz_bias(None)) == _preference_score(
            item, prefs, None, None
        )

    def test_ranking_prefers_liked_silhouettes(self):
        """The heuristic composer (no AI) sees the deck through score_items."""
        prefs = UserPreference(
            taste_profile={"liked": ["tailored"], "disliked": ["sporty"]},
            cold_threshold=10,
            hot_threshold=25,
            avoid_repeat_days=7,
            prefer_underused_items=False,
            variety_level="moderate",
        )
        items = [
            _item(name="blazer", type="outerwear", style=["formal", "elegant"], formality="formal"),
            _item(name="chándal", type="pants", style=["sporty", "athletic"], formality="casual"),
        ]
        scored = score_items(
            items=items,
            weather=_mild_weather(),
            occasion="formal",
            preferences=prefs,
            user_today=date(2026, 9, 23),
            current_season="fall",
            learned_prefs=None,
            good_pairs={},
            recently_worn_dates={},
            min_items=0,
        )
        assert scored[0].item.name == "blazer"


class TestEndpoints:
    ENDPOINT = "/api/v1/users/me/preferences/style-quiz"

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        assert (await client.get(self.ENDPOINT)).status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_empty_before_answering(self, client: AsyncClient, test_user, auth_headers):
        resp = await client.get(self.ENDPOINT, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["answered"] is False
        assert body["summary"] == []
        assert body["profile"] == empty_quiz()
        assert set(body["cards"]) == set(STYLE_CARD_IDS)

    @pytest.mark.asyncio
    async def test_save_and_read_back(self, client: AsyncClient, test_user, auth_headers):
        payload = {
            "liked": ["minimal", "tailored", "nope"],
            "disliked": ["boho"],
            "brands": ["Lemaire", "  Lemaire "],
            "never_wear": ["tacones"],
            "colors_avoid": ["amarillo"],
            "occasions": ["oficina"],
            "fit": "holgado",
            "completed": True,
        }
        resp = await client.put(self.ENDPOINT, json=payload, headers=auth_headers)
        assert resp.status_code == 200
        saved = resp.json()
        assert saved["profile"]["liked"] == ["minimal", "tailored"]
        assert saved["profile"]["brands"] == ["Lemaire"]
        assert saved["answered"] is True
        assert any("minimalismo limpio" in line for line in saved["summary"])
        assert saved["profile"]["version"] == QUIZ_VERSION
        assert saved["profile"]["updated_at"]

        again = await client.get(self.ENDPOINT, headers=auth_headers)
        assert again.json()["profile"] == saved["profile"]

    @pytest.mark.asyncio
    async def test_put_replaces_rather_than_merges(
        self, client: AsyncClient, test_user, auth_headers
    ):
        await client.put(self.ENDPOINT, json={"liked": ["boho"]}, headers=auth_headers)
        resp = await client.put(self.ENDPOINT, json={"liked": ["minimal"]}, headers=auth_headers)
        assert resp.json()["profile"]["liked"] == ["minimal"]

    @pytest.mark.asyncio
    async def test_empty_body_clears_the_answers(
        self, client: AsyncClient, test_user, auth_headers
    ):
        await client.put(self.ENDPOINT, json={"liked": ["minimal"]}, headers=auth_headers)
        resp = await client.put(self.ENDPOINT, json={}, headers=auth_headers)
        assert resp.json()["answered"] is False

    @pytest.mark.asyncio
    async def test_bad_fit_is_rejected(self, client: AsyncClient, test_user, auth_headers):
        resp = await client.put(self.ENDPOINT, json={"fit": "elegante"}, headers=auth_headers)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_does_not_disturb_the_other_preferences(
        self, client: AsyncClient, test_user, auth_headers
    ):
        await client.patch(
            "/api/v1/users/me/preferences",
            json={"color_favorites": ["navy"]},
            headers=auth_headers,
        )
        await client.put(self.ENDPOINT, json={"liked": ["minimal"]}, headers=auth_headers)
        prefs = await client.get("/api/v1/users/me/preferences", headers=auth_headers)
        assert prefs.json()["color_favorites"] == ["navy"]


def test_every_card_has_a_meaning():
    """A card the scorer cannot act on is only decoration — say so explicitly."""
    silent = [c.id for c in STYLE_CARDS if not c.styles and not c.colors]
    # "monochrome" is a rule about a look, not a tag we can match on an item.
    assert silent == ["monochrome"]
    assert STYLE_CARDS_BY_ID["monochrome"].category == "palette"
