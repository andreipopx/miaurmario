"""Layered garment combinations: a dress over trousers, a top under a top.

Four things are pinned down here:

1. **What the user builds always wins.** A hand-made outfit goes through the
   studio save path untouched — nothing de-duplicates it, drops a piece or
   refuses it.
2. **The wear log teaches the rules.** A same-slot collision this person has
   actually worn stops being pruned for them.
3. **The setting off changes nothing.** With «Me gusta superponer prendas» off
   and an empty wear log, every rule behaves exactly as it did before.
4. **The setting on allows, never forces.** It lifts the veto; it does not add
   a second piece to a look that did not want one.
"""

from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitItem, OutfitSource, OutfitStatus, UserFeedback
from app.models.preference import UserPreference
from app.models.user import User
from app.services.day_moments import NEUTRAL_WEATHER, compose_outfit
from app.services.layering import LayeringContext, layering_context, worn_layer_keys
from app.services.studio_service import StudioService
from app.utils.clothing import (
    LAYERABLE_KEYS,
    deduplicate_by_body_slot,
    layer_key,
    layer_keys_in_look,
)
from app.utils.style_quiz import (
    LAYERING_PROMPT_ES,
    empty_quiz,
    layering_allowed,
    normalize_quiz,
    quiz_prompt_lines,
    quiz_summary_lines,
)

DRESS_OVER_BOTTOM = layer_key("full_body", "bottom")
TOP_ON_TOP = layer_key("base_top", "base_top")


def _item(user_id, type_: str) -> ClothingItem:
    return ClothingItem(
        id=uuid4(),
        user_id=user_id,
        type=type_,
        name=type_,
        image_path=f"{user_id}/{uuid4().hex}.jpg",
        status=ItemStatus.ready,
        primary_color="black",
        wear_count=0,
        wears_since_wash=0,
        needs_wash=False,
        is_archived=False,
    )


# --- 1. The layer-key vocabulary ------------------------------------------------


class TestLayerKeys:
    def test_a_role_worn_twice_is_a_one_element_key(self):
        assert layer_key("base_top", "base_top") == frozenset({"base_top"})

    def test_key_does_not_depend_on_order(self):
        assert layer_key("full_body", "bottom") == layer_key("bottom", "full_body")

    def test_a_plain_look_has_no_collisions(self):
        assert layer_keys_in_look(["shirt", "pants", "sneakers"]) == set()

    def test_dress_over_trousers_is_one_collision(self):
        assert layer_keys_in_look(["dress", "jeans", "boots"]) == {DRESS_OVER_BOTTOM}

    def test_two_tops_collide_with_each_other(self):
        assert layer_keys_in_look(["shirt", "sweater", "pants"]) == {TOP_ON_TOP}

    def test_accessories_never_collide(self):
        assert layer_keys_in_look(["hat", "scarf", "belt", "bag"]) == set()

    def test_unknown_types_are_ignored(self):
        assert layer_keys_in_look(["kimono", "", None]) == set()  # type: ignore[list-item]

    def test_case_and_padding_do_not_matter(self):
        assert layer_keys_in_look([" Dress ", "JEANS"]) == {DRESS_OVER_BOTTOM}

    def test_the_layerable_set_is_exactly_the_three_documented_looks(self):
        assert LAYERABLE_KEYS == {
            DRESS_OVER_BOTTOM,
            layer_key("full_body", "base_top"),
            TOP_ON_TOP,
        }


# --- 2. deduplicate_by_body_slot ------------------------------------------------


class TestDedupeDefaultsAreUnchanged:
    """The setting off and nothing worn: byte-for-byte the old behaviour."""

    def test_dress_still_drops_trousers_by_default(self):
        uid = uuid4()
        dress, jeans, boots = _item(uid, "dress"), _item(uid, "jeans"), _item(uid, "boots")
        types = {i.id: i.type for i in (dress, jeans, boots)}
        assert deduplicate_by_body_slot([dress.id, jeans.id, boots.id], types) == [
            dress.id,
            boots.id,
        ]

    def test_second_top_still_dropped_by_default(self):
        uid = uuid4()
        shirt, sweater, pants = _item(uid, "shirt"), _item(uid, "sweater"), _item(uid, "pants")
        types = {i.id: i.type for i in (shirt, sweater, pants)}
        assert deduplicate_by_body_slot([shirt.id, sweater.id, pants.id], types) == [
            shirt.id,
            pants.id,
        ]

    def test_an_empty_keep_set_is_the_same_as_none(self):
        uid = uuid4()
        dress, jeans = _item(uid, "dress"), _item(uid, "jeans")
        types = {i.id: i.type for i in (dress, jeans)}
        assert deduplicate_by_body_slot([dress.id, jeans.id], types, keep_pairs=frozenset()) == [
            dress.id
        ]


class TestDedupeSparesLayers:
    def test_the_named_collision_survives(self):
        uid = uuid4()
        dress, jeans, boots = _item(uid, "dress"), _item(uid, "jeans"), _item(uid, "boots")
        types = {i.id: i.type for i in (dress, jeans, boots)}
        kept = deduplicate_by_body_slot(
            [dress.id, jeans.id, boots.id], types, keep_pairs={DRESS_OVER_BOTTOM}
        )
        assert kept == [dress.id, jeans.id, boots.id]

    def test_sparing_one_collision_does_not_spare_the_others(self):
        """Allowing a dress over trousers must not also allow two pairs of trousers."""
        uid = uuid4()
        dress, jeans, shorts = _item(uid, "dress"), _item(uid, "jeans"), _item(uid, "shorts")
        types = {i.id: i.type for i in (dress, jeans, shorts)}
        kept = deduplicate_by_body_slot(
            [dress.id, jeans.id, shorts.id], types, keep_pairs={DRESS_OVER_BOTTOM}
        )
        assert kept == [dress.id, jeans.id]

    def test_two_tops_survive_when_that_is_the_allowed_collision(self):
        uid = uuid4()
        shirt, sweater, pants = _item(uid, "shirt"), _item(uid, "sweater"), _item(uid, "pants")
        types = {i.id: i.type for i in (shirt, sweater, pants)}
        kept = deduplicate_by_body_slot(
            [shirt.id, sweater.id, pants.id], types, keep_pairs={TOP_ON_TOP}
        )
        assert kept == [shirt.id, sweater.id, pants.id]

    def test_a_shirt_under_a_dress_needs_its_own_key(self):
        uid = uuid4()
        dress, shirt = _item(uid, "dress"), _item(uid, "shirt")
        types = {i.id: i.type for i in (dress, shirt)}
        assert deduplicate_by_body_slot(
            [dress.id, shirt.id], types, keep_pairs={DRESS_OVER_BOTTOM}
        ) == [dress.id]
        assert deduplicate_by_body_slot(
            [dress.id, shirt.id], types, keep_pairs={layer_key("full_body", "base_top")}
        ) == [dress.id, shirt.id]

    def test_a_third_top_under_a_dress_still_needs_the_top_on_top_key(self):
        uid = uuid4()
        dress, shirt, sweater = _item(uid, "dress"), _item(uid, "shirt"), _item(uid, "sweater")
        types = {i.id: i.type for i in (dress, shirt, sweater)}
        assert deduplicate_by_body_slot(
            [dress.id, shirt.id, sweater.id],
            types,
            keep_pairs={layer_key("full_body", "base_top")},
        ) == [dress.id, shirt.id]

    def test_everything_layerable_at_once(self):
        uid = uuid4()
        dress, shirt, sweater, jeans = (
            _item(uid, "dress"),
            _item(uid, "shirt"),
            _item(uid, "sweater"),
            _item(uid, "jeans"),
        )
        types = {i.id: i.type for i in (dress, shirt, sweater, jeans)}
        kept = deduplicate_by_body_slot(
            [dress.id, shirt.id, sweater.id, jeans.id], types, keep_pairs=LAYERABLE_KEYS
        )
        assert kept == [dress.id, shirt.id, sweater.id, jeans.id]


# --- 3. The setting in the taste profile ----------------------------------------


class TestLayeringSetting:
    def test_off_by_default(self):
        assert empty_quiz()["layering"] is False
        assert normalize_quiz(None)["layering"] is False
        assert layering_allowed(None) is False
        assert layering_allowed({}) is False

    def test_junk_is_read_as_off_or_on_but_always_a_bool(self):
        assert normalize_quiz({"layering": "sí"})["layering"] is True
        assert normalize_quiz({"layering": 0})["layering"] is False
        assert normalize_quiz({"layering": None})["layering"] is False

    def test_reading_it_back(self):
        assert layering_allowed({"layering": True}) is True

    def test_off_adds_no_line_to_the_stylist_prompt(self):
        assert not any("capas" in line for line in quiz_prompt_lines({"layering": False}))

    def test_on_gives_the_stylist_permission_not_an_order(self):
        lines = quiz_prompt_lines({"layering": True})
        assert LAYERING_PROMPT_ES in lines
        assert "puede combinar capas" in LAYERING_PROMPT_ES.lower()
        assert "no es" not in LAYERING_PROMPT_ES  # it says "permiso, no obligación"
        assert "obligación" in LAYERING_PROMPT_ES

    def test_on_is_read_back_to_the_user_in_spanish(self):
        summary = quiz_summary_lines({"layering": True})
        assert any("superponer" in line for line in summary)
        assert quiz_summary_lines({"layering": False}) == []

    def test_it_says_nothing_about_the_person(self):
        for word in ("favorec", "figura", "cuerpo", "peso", "delgad", "gord"):
            assert word not in LAYERING_PROMPT_ES.lower()


class TestLayeringContext:
    def test_nothing_is_spared_by_default(self):
        assert LayeringContext().keep_pairs == frozenset()

    def test_the_setting_spares_every_layerable_collision(self):
        assert LayeringContext(allowed=True).keep_pairs == LAYERABLE_KEYS

    def test_the_wear_log_spares_only_what_was_worn(self):
        ctx = LayeringContext(allowed=False, worn_keys=frozenset({DRESS_OVER_BOTTOM}))
        assert ctx.keep_pairs == {DRESS_OVER_BOTTOM}

    def test_the_two_sources_add_up(self):
        ctx = LayeringContext(allowed=True, worn_keys=frozenset({layer_key("bottom", "bottom")}))
        assert ctx.keep_pairs == LAYERABLE_KEYS | {layer_key("bottom", "bottom")}


# --- 4. The wear log -------------------------------------------------------------


@pytest_asyncio.fixture
async def layering_user(db_session) -> User:
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"layering-{uid}",
        email=f"layering-{uid}@example.com",
        display_name="Layering Tester",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def wardrobe(db_session, layering_user) -> dict[str, ClothingItem]:
    items = {
        name: _item(layering_user.id, type_)
        for name, type_ in (
            ("dress", "dress"),
            ("jeans", "jeans"),
            ("shirt", "shirt"),
            ("sweater", "sweater"),
            ("boots", "boots"),
        )
    }
    db_session.add_all(items.values())
    await db_session.commit()
    for item in items.values():
        await db_session.refresh(item)
    return items


async def _worn_outfit(db_session, user: User, items: list[ClothingItem], *, worn: bool) -> Outfit:
    outfit = Outfit(
        user_id=user.id,
        occasion="casual",
        scheduled_for=date(2026, 9, 1),
        source=OutfitSource.manual,
        status=OutfitStatus.pending,
    )
    db_session.add(outfit)
    await db_session.flush()
    for position, item in enumerate(items):
        db_session.add(OutfitItem(outfit_id=outfit.id, item_id=item.id, position=position))
    db_session.add(
        UserFeedback(
            outfit_id=outfit.id,
            accepted=True,
            worn_at=date(2026, 9, 1) if worn else None,
        )
    )
    await db_session.commit()
    return outfit


class TestWearLog:
    @pytest.mark.asyncio
    async def test_an_empty_wear_log_spares_nothing(self, db_session, layering_user):
        assert await worn_layer_keys(db_session, layering_user.id) == frozenset()

    @pytest.mark.asyncio
    async def test_a_plain_look_teaches_nothing(self, db_session, layering_user, wardrobe):
        await _worn_outfit(
            db_session,
            layering_user,
            [wardrobe["shirt"], wardrobe["jeans"], wardrobe["boots"]],
            worn=True,
        )
        assert await worn_layer_keys(db_session, layering_user.id) == frozenset()

    @pytest.mark.asyncio
    async def test_a_dress_worn_over_trousers_is_learned(self, db_session, layering_user, wardrobe):
        await _worn_outfit(
            db_session,
            layering_user,
            [wardrobe["dress"], wardrobe["jeans"], wardrobe["boots"]],
            worn=True,
        )
        assert await worn_layer_keys(db_session, layering_user.id) == {DRESS_OVER_BOTTOM}

    @pytest.mark.asyncio
    async def test_an_outfit_that_was_never_worn_teaches_nothing(
        self, db_session, layering_user, wardrobe
    ):
        """A saved lookbook idea is not evidence that they wear it."""
        await _worn_outfit(
            db_session, layering_user, [wardrobe["dress"], wardrobe["jeans"]], worn=False
        )
        assert await worn_layer_keys(db_session, layering_user.id) == frozenset()

    @pytest.mark.asyncio
    async def test_it_is_per_user(self, db_session, layering_user, wardrobe):
        await _worn_outfit(
            db_session, layering_user, [wardrobe["dress"], wardrobe["jeans"]], worn=True
        )
        stranger = uuid4()
        assert await worn_layer_keys(db_session, stranger) == frozenset()

    @pytest.mark.asyncio
    async def test_a_worn_pair_is_no_longer_deduped_for_that_user(
        self, db_session, layering_user, wardrobe
    ):
        """The whole point: the rules stop second-guessing what she really wears."""
        dress, jeans, boots = wardrobe["dress"], wardrobe["jeans"], wardrobe["boots"]
        types = {i.id: i.type for i in (dress, jeans, boots)}
        ids = [dress.id, jeans.id, boots.id]

        before = await layering_context(db_session, layering_user.id)
        assert deduplicate_by_body_slot(ids, types, keep_pairs=before.keep_pairs) == [
            dress.id,
            boots.id,
        ]

        await _worn_outfit(db_session, layering_user, [dress, jeans, boots], worn=True)

        after = await layering_context(db_session, layering_user.id)
        assert deduplicate_by_body_slot(ids, types, keep_pairs=after.keep_pairs) == ids

    @pytest.mark.asyncio
    async def test_learning_one_collision_does_not_unlock_the_others(
        self, db_session, layering_user, wardrobe
    ):
        await _worn_outfit(
            db_session, layering_user, [wardrobe["dress"], wardrobe["jeans"]], worn=True
        )
        ctx = await layering_context(db_session, layering_user.id)
        assert ctx.allowed is False
        assert ctx.keep_pairs == {DRESS_OVER_BOTTOM}
        assert TOP_ON_TOP not in ctx.keep_pairs

    @pytest.mark.asyncio
    async def test_the_setting_is_read_from_the_taste_profile(
        self, db_session, layering_user, wardrobe
    ):
        db_session.add(UserPreference(user_id=layering_user.id, taste_profile={"layering": True}))
        await db_session.commit()
        ctx = await layering_context(db_session, layering_user.id)
        assert ctx.allowed is True
        assert ctx.keep_pairs == LAYERABLE_KEYS

    @pytest.mark.asyncio
    async def test_no_preferences_row_at_all_means_off(self, db_session, layering_user):
        ctx = await layering_context(db_session, layering_user.id)
        assert ctx.allowed is False
        assert ctx.keep_pairs == frozenset()


# --- 5. What the user builds always wins ----------------------------------------


class TestHandBuiltOutfitsSurviveTheSavePath:
    @pytest.mark.asyncio
    async def test_dress_and_trousers_are_saved_exactly_as_chosen(
        self, db_session, layering_user, wardrobe
    ):
        dress, jeans, boots = wardrobe["dress"], wardrobe["jeans"], wardrobe["boots"]
        outfit = await StudioService(db_session).create_from_scratch(
            user=layering_user,
            item_ids=[dress.id, jeans.id, boots.id],
            occasion="casual",
            name="Vestido sobre pantalón",
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
        )
        await db_session.commit()
        assert {oi.item_id for oi in outfit.items} == {dress.id, jeans.id, boots.id}

    @pytest.mark.asyncio
    async def test_two_tops_are_saved_exactly_as_chosen(self, db_session, layering_user, wardrobe):
        shirt, sweater, jeans = wardrobe["shirt"], wardrobe["sweater"], wardrobe["jeans"]
        outfit = await StudioService(db_session).create_from_scratch(
            user=layering_user,
            item_ids=[shirt.id, sweater.id, jeans.id],
            occasion="casual",
            name=None,
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
        )
        await db_session.commit()
        assert {oi.item_id for oi in outfit.items} == {shirt.id, sweater.id, jeans.id}

    @pytest.mark.asyncio
    async def test_the_setting_being_off_does_not_hold_it_back(
        self, db_session, layering_user, wardrobe
    ):
        """Hand-built looks never consult «Me gusta superponer prendas»."""
        db_session.add(UserPreference(user_id=layering_user.id, taste_profile={"layering": False}))
        await db_session.commit()
        dress, jeans = wardrobe["dress"], wardrobe["jeans"]
        outfit = await StudioService(db_session).create_from_scratch(
            user=layering_user,
            item_ids=[dress.id, jeans.id],
            occasion="casual",
            name=None,
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
        )
        await db_session.commit()
        assert len(outfit.items) == 2

    @pytest.mark.asyncio
    async def test_the_canvas_order_the_user_laid_out_is_kept(
        self, db_session, layering_user, wardrobe
    ):
        """With canvas coordinates the authoring order wins — trousers first,
        dress on top — so nothing is reordered away from what she arranged."""
        from app.services.studio_service import ItemLayoutInput

        dress, jeans = wardrobe["dress"], wardrobe["jeans"]
        outfit = await StudioService(db_session).create_from_scratch(
            user=layering_user,
            item_ids=[jeans.id, dress.id],
            occasion="casual",
            name=None,
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
            layouts=[
                ItemLayoutInput(item_id=jeans.id, pos_x=0.5, pos_y=0.6, z_index=0),
                ItemLayoutInput(item_id=dress.id, pos_x=0.5, pos_y=0.4, z_index=1),
            ],
        )
        await db_session.commit()
        ordered = [oi.item_id for oi in sorted(outfit.items, key=lambda x: x.position)]
        assert ordered == [jeans.id, dress.id]

    @pytest.mark.asyncio
    async def test_editing_a_look_into_a_layered_one_keeps_every_piece(
        self, db_session, layering_user, wardrobe
    ):
        service = StudioService(db_session)
        shirt, jeans, dress = wardrobe["shirt"], wardrobe["jeans"], wardrobe["dress"]
        outfit = await service.create_from_scratch(
            user=layering_user,
            item_ids=[shirt.id, jeans.id],
            occasion="casual",
            name=None,
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
        )
        await db_session.commit()

        patched = await service.patch_outfit(
            user=layering_user,
            outfit_id=outfit.id,
            name=None,
            items=[dress.id, jeans.id],
        )
        await db_session.commit()
        assert {oi.item_id for oi in patched.items} == {dress.id, jeans.id}

    @pytest.mark.asyncio
    async def test_the_api_accepts_a_layered_look(
        self, client, db_session, layering_user, wardrobe
    ):
        from app.api.auth import create_access_token

        headers = {"Authorization": f"Bearer {create_access_token(layering_user.external_id)}"}
        dress, jeans, boots = wardrobe["dress"], wardrobe["jeans"], wardrobe["boots"]
        response = await client.post(
            "/api/v1/outfits/studio",
            headers=headers,
            json={
                "items": [str(dress.id), str(jeans.id), str(boots.id)],
                "occasion": "casual",
                "name": "Vestido sobre pantalón",
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert len(body["items"]) == 3
        assert {i["id"] for i in body["items"]} == {str(dress.id), str(jeans.id), str(boots.id)}

    @pytest.mark.asyncio
    async def test_the_saved_look_teaches_the_rules_once_it_is_worn(
        self, client, db_session, layering_user, wardrobe
    ):
        """End to end: build it by hand, wear it, and the stylist stops pruning it."""
        from app.api.auth import create_access_token

        headers = {"Authorization": f"Bearer {create_access_token(layering_user.external_id)}"}
        dress, jeans = wardrobe["dress"], wardrobe["jeans"]
        response = await client.post(
            "/api/v1/outfits/studio",
            headers=headers,
            json={
                "items": [str(dress.id), str(jeans.id)],
                "occasion": "casual",
                "mark_worn": True,
                "scheduled_for": "2026-09-01",
            },
        )
        assert response.status_code == 201, response.text

        outfit_id = response.json()["id"]
        feedback = (
            await db_session.execute(
                select(UserFeedback).where(UserFeedback.outfit_id == outfit_id)
            )
        ).scalar_one()
        assert feedback.worn_at == date(2026, 9, 1)

        ctx = await layering_context(db_session, layering_user.id)
        assert DRESS_OVER_BOTTOM in ctx.keep_pairs


# --- 6. The heuristic composer ---------------------------------------------------


class TestComposerLayering:
    def _ranked(self, items):
        return [(i, 1.0 - n * 0.01) for n, i in enumerate(items)]

    def test_off_a_pinned_bottom_rules_the_dress_out(self):
        uid = uuid4()
        dress, jeans, boots = _item(uid, "dress"), _item(uid, "jeans"), _item(uid, "boots")
        composed = compose_outfit(
            self._ranked([dress, jeans, boots]), NEUTRAL_WEATHER, "casual", pinned=jeans
        )
        assert jeans.id in composed.item_ids
        assert dress.id not in composed.item_ids

    def test_on_a_pinned_bottom_may_be_worn_under_the_dress(self):
        uid = uuid4()
        dress, jeans, boots = _item(uid, "dress"), _item(uid, "jeans"), _item(uid, "boots")
        composed = compose_outfit(
            self._ranked([dress, jeans, boots]),
            NEUTRAL_WEATHER,
            "casual",
            pinned=jeans,
            allow_layering=True,
        )
        assert {dress.id, jeans.id} <= set(composed.item_ids)

    def test_on_does_not_force_a_layer_onto_a_look_that_did_not_want_one(self):
        """Same ranking, setting on: a dress look stays a dress look."""
        uid = uuid4()
        dress, jeans, shirt, boots = (
            _item(uid, "dress"),
            _item(uid, "jeans"),
            _item(uid, "shirt"),
            _item(uid, "boots"),
        )
        ranked = self._ranked([dress, boots, shirt, jeans])
        off = compose_outfit(ranked, NEUTRAL_WEATHER, "casual")
        on = compose_outfit(ranked, NEUTRAL_WEATHER, "casual", allow_layering=True)
        assert on.item_ids == off.item_ids
        assert jeans.id not in on.item_ids

    def test_on_changes_nothing_for_a_plain_separates_look(self):
        uid = uuid4()
        shirt, pants, shoes = _item(uid, "shirt"), _item(uid, "pants"), _item(uid, "sneakers")
        ranked = self._ranked([shirt, pants, shoes])
        assert (
            compose_outfit(ranked, NEUTRAL_WEATHER, "casual", allow_layering=True).item_ids
            == compose_outfit(ranked, NEUTRAL_WEATHER, "casual").item_ids
        )

    def test_a_pinned_dress_is_still_the_whole_look_either_way(self):
        uid = uuid4()
        dress, jeans, boots = _item(uid, "dress"), _item(uid, "jeans"), _item(uid, "boots")
        ranked = self._ranked([jeans, boots, dress])
        for allow in (False, True):
            composed = compose_outfit(
                ranked, NEUTRAL_WEATHER, "casual", pinned=dress, allow_layering=allow
            )
            assert dress.id in composed.item_ids
            assert jeans.id not in composed.item_ids

    def test_the_cold_weather_rules_are_untouched(self):
        uid = uuid4()
        shirt, pants, boots, coat = (
            _item(uid, "shirt"),
            _item(uid, "pants"),
            _item(uid, "boots"),
            _item(uid, "coat"),
        )
        cold = SimpleNamespace(feels_like=4.0, precipitation_chance=0)
        composed = compose_outfit(
            self._ranked([shirt, pants, boots, coat]), cold, "casual", allow_layering=True
        )
        assert coat.id in composed.item_ids
