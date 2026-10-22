"""How Stinky talks: estilista / gato / muy gato / solo miau (the last one never
reaches the model)."""

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.chat import ChatMessage
from app.services.notification_service import NotificationDispatcher
from app.utils import meows as meows_mod
from app.utils.stinky_persona import (
    clean_voice,
    meow_only,
    personalize_prompt,
    stinky_voice,
)
from tests.test_stinky_chat import _headers, _make_user, parse_sse

PROMPT = "Eres Stinky, el gato esmoquin.\nDevuelve JSON."


def test_voices_are_validated_and_default_is_stored_as_null():
    assert clean_voice(None) is None
    assert clean_voice("gato") is None
    assert clean_voice("solo-miau") == "solo-miau"
    with pytest.raises(ValueError):
        clean_voice("perro")
    assert stinky_voice(SimpleNamespace(stinky_voice=None)) == "gato"
    assert stinky_voice(SimpleNamespace(stinky_voice="raro")) == "gato"


def test_prompt_gets_the_chosen_tone_only_when_it_is_not_the_default():
    default = SimpleNamespace(stinky_voice=None, stinky_name=None)
    assert personalize_prompt(PROMPT, default) == PROMPT
    stylist = SimpleNamespace(stinky_voice="estilista", stinky_name="Chan")
    out = personalize_prompt(PROMPT, stylist)
    assert out.startswith("Eres Chan")
    assert "«Estilista»" in out and "sin sonidos gatunos" in out
    assert "el formato que se te pide sigue igual" in out
    assert "«Muy gato»" in personalize_prompt(PROMPT, SimpleNamespace(stinky_voice="muy-gato"))


def test_meows_are_only_meows_and_repeat_for_the_same_seed():
    first = meows_mod.meows("look-1")
    assert first == meows_mod.meows("look-1")
    words = first.replace("*", " ").replace("🐾", " ").split()
    allowed = {w.lower() for s in meows_mod.SOUNDS for w in s.split()} | {
        w for a in meows_mod.ASIDES for w in a.strip("*").split()
    }
    assert all(w.strip(".!?…~,").lower() in allowed for w in words if w.strip(".!?…~,"))


async def test_solo_miau_chat_needs_no_ai_and_calls_no_model(client, db_session, monkeypatch):
    user = await _make_user(db_session, ai=None)  # no AI plan at all
    user.stinky_voice = "solo-miau"
    await db_session.commit()

    def boom(**kwargs):
        raise AssertionError("the model must not be called")

    from app.services.stinky_chat import provider as provider_mod

    monkeypatch.setattr(provider_mod, "_make_client", boom)
    resp = await client.post(
        "/api/v1/stinky/chat", json={"message": "¿Qué me pongo?"}, headers=_headers(user)
    )
    assert resp.status_code == 200, resp.text
    events = parse_sse(resp.text)
    assert events[-1][0] == "done" and events[-1][1]["tokens"] == 0
    said = "".join(d["text"] for n, d in events if n == "delta").strip()
    assert said
    stored = (
        (
            await db_session.execute(
                select(ChatMessage.content)
                .where(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    assert stored == said


async def test_profile_saves_and_returns_the_voice(client, db_session):
    user = await _make_user(db_session)
    resp = await client.patch(
        "/api/v1/users/me", json={"stinky_voice": "muy-gato"}, headers=_headers(user)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["stinky_voice"] == "muy-gato"
    bad = await client.patch(
        "/api/v1/users/me", json={"stinky_voice": "ladra"}, headers=_headers(user)
    )
    assert bad.status_code == 422


def test_look_push_meows_in_solo_miau():
    outfit = SimpleNamespace(
        id="o1", occasion="casual", weather_data={"temperature": 18}, reasoning="Jersey y vaqueros."
    )
    service = NotificationDispatcher.__new__(NotificationDispatcher)
    cat = SimpleNamespace(stinky_voice="solo-miau", stinky_name=None)
    body = service._outfit_push(outfit, False, cat).body
    assert "Jersey" not in body and body.startswith("18°C · ")
    assert meow_only(cat)
    plain = service._outfit_push(
        outfit, False, SimpleNamespace(stinky_voice=None, stinky_name=None)
    )
    assert "Jersey y vaqueros." in plain.body
