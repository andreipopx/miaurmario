"""«Stinky recuerda»: the memory Stinky writes about a user while they chat.

Covers the service (refusals, dedupe, cap/eviction, digest capping), the
``remember``/``forget`` chat tools, the Ajustes API (edit, pin, delete, borrar
todo, preferred name), per-user isolation, the no-AI path and the deletion
cascade.
"""

import json
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.models.stinky_memory import (
    MAX_MEMORIES_PER_USER,
    MEMORY_KIND_NAME,
    StinkyMemory,
)
from app.models.user import User
from app.services import stinky_memory as memory
from app.services.account_deletion import delete_user_rows
from app.services.stinky_chat.service import build_system_prompt
from app.services.stinky_chat.tools import (
    MAX_MEMORY_WRITES_PER_TURN,
    ToolContext,
    run_tool,
)

PREFIX = "/api/v1/stinky/memory"


# --- Fixtures --------------------------------------------------------------------------


async def _make_user(db_session: AsyncSession) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        external_id=f"mem-{uid}",
        email=f"mem-{uid}@example.com",
        display_name="Cuenta Oficial",
        timezone="UTC",
        is_active=True,
        onboarding_completed=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


@pytest_asyncio.fixture
async def user(db_session):
    return await _make_user(db_session)


@pytest_asyncio.fixture
async def other_user(db_session):
    return await _make_user(db_session)


def _ctx(db_session, user) -> ToolContext:
    # No conversation_id: the per-conversation Redis limit is exercised separately.
    return ToolContext(db=db_session, user=user)


async def _run(ctx: ToolContext, name: str, args: dict) -> dict:
    return json.loads(await run_tool(ctx, name, json.dumps(args)))


# --- What Stinky refuses to write down ---------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "tiene ansiedad y no quiere salir",
        "está a dieta y quiere adelgazar",
        "pesa 80 kg",
        "es católica y va a misa los domingos",
        "es bisexual",
        "vota a la izquierda",
        "está en el paro y no puede permitirse ropa nueva",
        "su contraseña es gatito123",
        "she is pregnant",
        "his weight is going up",
    ],
)
async def test_sensitive_notes_are_refused(db_session, user, text):
    with pytest.raises(memory.SensitiveMemory):
        await memory.remember(db_session, user.id, "fact", text)
    assert await memory.count_memories(db_session, user.id) == 0


async def test_remember_tool_refuses_sensitive_and_says_why(db_session, user):
    ctx = _ctx(db_session, user)
    result = await _run(ctx, "remember", {"kind": "fact", "text": "tiene depresión"})
    assert result["ok"] is False
    assert "salud" in result["error"]
    assert ctx.notes == []
    assert await memory.count_memories(db_session, user.id) == 0


async def test_remember_tool_rejects_unknown_kind_and_empty_text(db_session, user):
    ctx = _ctx(db_session, user)
    bad_kind = await _run(ctx, "remember", {"kind": "diagnosis", "text": "le gusta el negro"})
    assert bad_kind["ok"] is False
    empty = await _run(ctx, "remember", {"kind": "fact", "text": "   "})
    assert empty["ok"] is False
    assert await memory.count_memories(db_session, user.id) == 0


async def test_ordinary_style_notes_are_allowed(db_session, user):
    for kind, text in (
        ("preference", "le encanta el pantalón ancho"),
        ("dislike", "no se pone rojo"),
        ("plan", "trabaja en oficina los martes"),
        ("context", "vive en un sitio lluvioso"),
        ("fact", "alérgica a la lana"),
    ):
        row, action = await memory.remember(db_session, user.id, kind, text)
        assert action == "created"
        assert row.kind == kind
    await db_session.commit()
    assert await memory.count_memories(db_session, user.id) == 5


# --- Dedupe ------------------------------------------------------------------------------


async def test_near_identical_note_updates_instead_of_duplicating(db_session, user):
    first, _ = await memory.remember(
        db_session, user.id, "preference", "le gusta el pantalón ancho"
    )
    second, action = await memory.remember(
        db_session, user.id, "preference", "le gusta mucho el pantalón ancho de lino"
    )
    await db_session.commit()
    assert action == "updated"
    assert second.id == first.id
    assert second.text == "le gusta mucho el pantalón ancho de lino"
    assert await memory.count_memories(db_session, user.id) == 1


async def test_identical_note_is_unchanged(db_session, user):
    await memory.remember(db_session, user.id, "dislike", "no lleva rojo")
    row, action = await memory.remember(db_session, user.id, "dislike", "No lleva rojo")
    await db_session.commit()
    assert action == "unchanged"
    assert row.text == "no lleva rojo"
    assert await memory.count_memories(db_session, user.id) == 1


async def test_unchanged_note_is_not_shown_as_a_new_note(db_session, user):
    ctx = _ctx(db_session, user)
    await _run(ctx, "remember", {"kind": "dislike", "text": "no lleva rojo"})
    assert len(ctx.notes) == 1
    await _run(ctx, "remember", {"kind": "dislike", "text": "no lleva rojo"})
    assert len(ctx.notes) == 1


async def test_notes_that_differ_by_a_number_are_not_merged(db_session, user):
    """Sizes are the classic trap: merging them would silently lose one."""
    await memory.remember(db_session, user.id, "fact", "usa la talla 42 de pantalón")
    await memory.remember(db_session, user.id, "fact", "usa la talla 44 de pantalón")
    await db_session.commit()
    assert await memory.count_memories(db_session, user.id) == 2


async def test_different_notes_of_the_same_kind_coexist(db_session, user):
    await memory.remember(db_session, user.id, "dislike", "no lleva rojo")
    await memory.remember(db_session, user.id, "dislike", "odia los tacones altos")
    await db_session.commit()
    assert await memory.count_memories(db_session, user.id) == 2


# --- The preferred name ------------------------------------------------------------------


async def test_call_name_is_a_singleton_and_pinned(db_session, user):
    await memory.remember(db_session, user.id, MEMORY_KIND_NAME, "Andrea")
    row, action = await memory.remember(db_session, user.id, MEMORY_KIND_NAME, "Andre")
    await db_session.commit()
    assert action == "updated"
    assert row.pinned is True
    assert await memory.get_call_name(db_session, user.id) == "Andre"
    assert await memory.count_memories(db_session, user.id) == 1


async def test_call_name_beats_the_account_name_in_the_prompt(db_session, user):
    prompt = build_system_prompt(user, "es", "", "Andrea")
    assert '"Andrea"' in prompt
    assert '"Cuenta Oficial"' in prompt  # the account name is still stated, separately


# --- Cap and eviction --------------------------------------------------------------------


async def test_cap_evicts_the_oldest_unpinned_least_used(db_session, user):
    pinned, _ = await memory.remember(db_session, user.id, "preference", "nota fijada intocable")
    pinned.pinned = True
    await memory.remember(db_session, user.id, MEMORY_KIND_NAME, "Andrea")
    stale, _ = await memory.remember(db_session, user.id, "fact", "nota vieja que nadie usa")
    await db_session.commit()

    for i in range(MAX_MEMORIES_PER_USER):
        await memory.remember(db_session, user.id, "fact", f"apunte numero {i} sobre prendas")
    await db_session.commit()

    total = await memory.count_memories(db_session, user.id)
    assert total == MAX_MEMORIES_PER_USER
    assert await db_session.get(StinkyMemory, pinned.id) is not None
    assert await memory.get_call_name(db_session, user.id) == "Andrea"
    assert await db_session.get(StinkyMemory, stale.id) is None


# --- Digest ------------------------------------------------------------------------------


async def test_digest_is_capped_and_prefers_pinned(db_session, user):
    await memory.remember(db_session, user.id, MEMORY_KIND_NAME, "Andrea")
    important, _ = await memory.remember(
        db_session, user.id, "dislike", "no se pone nada de color rojo jamas"
    )
    important.pinned = True
    for i in range(40):
        await memory.remember(
            db_session, user.id, "fact", f"apunte de relleno numero {i} sobre ropa"
        )
    await db_session.commit()

    digest = await memory.build_digest(db_session, user.id)
    assert len(digest) <= memory.MAX_DIGEST_CHARS + len(memory.DIGEST_HEADER) + 1
    body = digest[len(memory.DIGEST_HEADER) :]
    assert len(body.strip()) <= memory.MAX_DIGEST_CHARS
    lines = body.strip().splitlines()
    assert lines[0] == "- Le gusta que le llamen: Andrea"
    assert "- No le gusta: no se pone nada de color rojo jamas" in lines
    assert len(lines) < 42  # the cap really dropped some


async def test_digest_is_empty_without_memories(db_session, user):
    assert await memory.build_digest(db_session, user.id) == ""
    prompt = build_system_prompt(user, "es", "", None)
    assert "Tu cuaderno está vacío" in prompt


async def test_digest_marks_notes_as_used(db_session, user):
    row, _ = await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await db_session.commit()
    assert row.last_used_at is None
    await memory.build_digest(db_session, user.id, mark_used=True)
    await db_session.commit()
    await db_session.refresh(row)
    assert row.last_used_at is not None


async def test_stylist_subset_leaves_out_the_name_and_context(db_session, user):
    await memory.remember(db_session, user.id, MEMORY_KIND_NAME, "Andrea")
    await memory.remember(db_session, user.id, "context", "le gusta hacer siestas largas")
    await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await db_session.commit()
    text = await memory.stylist_memory_lines(db_session, user.id)
    assert "Andrea" not in text
    assert "siestas" not in text
    assert "lino" in text


async def test_style_profile_prompt_includes_the_memory(db_session, user):
    from app.utils.style_profile import format_style_profile_for_prompt

    await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await db_session.commit()
    text = await memory.stylist_memory_lines(db_session, user.id)
    block = format_style_profile_for_prompt(None, memory_text=text)
    assert "le gusta el lino" in block


# --- Chat tools ---------------------------------------------------------------------------


async def test_remember_tool_writes_a_note_and_an_inline_note(db_session, user):
    ctx = _ctx(db_session, user)
    result = await _run(ctx, "remember", {"kind": "preference", "text": "le gusta el lino"})
    assert result["ok"] is True
    assert result["data"]["action"] == "created"
    assert ctx.notes == [{"kind": "preference", "text": "le gusta el lino", "action": "created"}]
    assert await memory.get_call_name(db_session, user.id) is None
    assert await memory.count_memories(db_session, user.id) == 1


async def test_remember_tool_is_rate_limited_per_turn(db_session, user):
    ctx = _ctx(db_session, user)
    for i in range(MAX_MEMORY_WRITES_PER_TURN):
        ok = await _run(ctx, "remember", {"kind": "fact", "text": f"apunte distinto numero {i}"})
        assert ok["ok"] is True
    blocked = await _run(ctx, "remember", {"kind": "fact", "text": "una cosa mas totalmente nueva"})
    assert blocked["ok"] is False
    assert await memory.count_memories(db_session, user.id) == MAX_MEMORY_WRITES_PER_TURN


async def test_forget_tool_by_id_and_by_text(db_session, user):
    ctx = _ctx(db_session, user)
    created = await _run(ctx, "remember", {"kind": "dislike", "text": "no lleva rojo"})
    by_id = await _run(ctx, "forget", {"id": created["data"]["id"]})
    assert by_id["data"]["forgotten"] == 1
    assert await memory.count_memories(db_session, user.id) == 0

    await _run(ctx, "remember", {"kind": "plan", "text": "trabaja en oficina los martes"})
    by_text = await _run(ctx, "forget", {"text": "trabaja en oficina los martes"})
    assert by_text["data"]["forgotten"] == 1
    assert await memory.count_memories(db_session, user.id) == 0


async def test_forget_tool_never_reaches_another_users_notes(db_session, user, other_user):
    theirs, _ = await memory.remember(db_session, other_user.id, "fact", "nota de otra persona")
    await db_session.commit()
    ctx = _ctx(db_session, user)
    result = await _run(ctx, "forget", {"id": str(theirs.id)})
    assert result["data"]["forgotten"] == 0
    assert await memory.count_memories(db_session, other_user.id) == 1


# --- The Ajustes API -----------------------------------------------------------------------


async def test_list_edit_pin_and_delete(client, db_session, user):
    row, _ = await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await db_session.commit()

    listed = await client.get(PREFIX, headers=_headers(user))
    assert listed.status_code == 200
    body = listed.json()
    assert body["call_name"] is None
    assert [m["text"] for m in body["memories"]] == ["le gusta el lino"]
    assert body["max_entries"] == MAX_MEMORIES_PER_USER

    edited = await client.patch(
        f"{PREFIX}/{row.id}",
        headers=_headers(user),
        json={"text": "le gusta el lino arrugado", "pinned": True},
    )
    assert edited.status_code == 200
    assert edited.json()["text"] == "le gusta el lino arrugado"
    assert edited.json()["pinned"] is True
    assert edited.json()["source"] == "user"

    deleted = await client.delete(f"{PREFIX}/{row.id}", headers=_headers(user))
    assert deleted.status_code == 204
    assert await memory.count_memories(db_session, user.id) == 0


async def test_editing_a_note_into_something_sensitive_is_refused(client, db_session, user):
    row, _ = await memory.remember(db_session, user.id, "fact", "alérgica a la lana")
    await db_session.commit()
    resp = await client.patch(
        f"{PREFIX}/{row.id}", headers=_headers(user), json={"text": "pesa 80 kg"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "sensitive"
    await db_session.refresh(row)
    assert row.text == "alérgica a la lana"


async def test_borrar_todo_wipes_everything_including_the_name(client, db_session, user):
    await memory.remember(db_session, user.id, MEMORY_KIND_NAME, "Andrea")
    await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await db_session.commit()

    resp = await client.delete(PREFIX, headers=_headers(user))
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 2
    assert await memory.count_memories(db_session, user.id) == 0


async def test_set_and_clear_the_call_name(client, db_session, user):
    resp = await client.put(f"{PREFIX}/name", headers=_headers(user), json={"name": "Andrea"})
    assert resp.status_code == 200
    assert resp.json()["call_name"] == "Andrea"
    # The preferred name is not listed among the ordinary notes.
    assert resp.json()["memories"] == []

    cleared = await client.put(f"{PREFIX}/name", headers=_headers(user), json={"name": ""})
    assert cleared.status_code == 200
    assert cleared.json()["call_name"] is None
    assert await memory.count_memories(db_session, user.id) == 0


async def test_the_api_never_shows_or_touches_another_users_memories(
    client, db_session, user, other_user
):
    theirs, _ = await memory.remember(db_session, other_user.id, "fact", "nota de otra persona")
    await db_session.commit()

    listed = await client.get(PREFIX, headers=_headers(user))
    assert listed.json()["memories"] == []

    assert (await client.get(PREFIX, headers=_headers(user))).status_code == 200
    assert (
        await client.patch(f"{PREFIX}/{theirs.id}", headers=_headers(user), json={"pinned": True})
    ).status_code == 404
    assert (await client.delete(f"{PREFIX}/{theirs.id}", headers=_headers(user))).status_code == 404
    assert (await client.delete(PREFIX, headers=_headers(user))).json()["deleted"] == 0
    assert await memory.count_memories(db_session, other_user.id) == 1


async def test_memory_requires_authentication(client):
    assert (await client.get(PREFIX)).status_code in (401, 403)


# --- No AI ---------------------------------------------------------------------------------


async def test_memory_page_works_without_any_ai(client, db_session, user, monkeypatch):
    """The notebook is plain rows: it must read and write with AI switched off."""
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "ai_base_url", "")
    monkeypatch.setattr(settings, "ai_api_key", "")

    await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await db_session.commit()

    resp = await client.get(PREFIX, headers=_headers(user))
    assert resp.status_code == 200
    assert len(resp.json()["memories"]) == 1
    assert (await client.delete(PREFIX, headers=_headers(user))).status_code == 200


# --- Deletion --------------------------------------------------------------------------------


async def test_account_deletion_wipes_the_memories(db_session, user, other_user):
    await memory.remember(db_session, user.id, "preference", "le gusta el lino")
    await memory.remember(db_session, other_user.id, "preference", "le gusta el denim")
    await db_session.commit()

    await delete_user_rows(db_session, user)
    await db_session.commit()

    remaining = (
        await db_session.execute(
            select(func.count()).select_from(StinkyMemory).where(StinkyMemory.user_id == user.id)
        )
    ).scalar_one()
    assert remaining == 0
    # ...and only that user's notebook.
    assert await memory.count_memories(db_session, other_user.id) == 1
