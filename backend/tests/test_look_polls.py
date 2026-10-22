"""«¿Cuál me pongo?»: friends vote on two or three of your looks."""

from unittest.mock import AsyncMock, patch

import pytest

from tests.test_social import API, _befriend, _headers, _make_outfit, _make_user


@pytest.fixture(autouse=True)
def _no_rate_limit():
    with patch("app.api.social.rate_limit_by_user", AsyncMock()):
        yield


class TestLookPolls:
    async def test_ask_vote_and_see_results(self, client, db_session):
        ana = await _make_user(db_session, "ana")
        bea = await _make_user(db_session, "bea")
        eve = await _make_user(db_session, "eve")  # not a friend
        await _befriend(client, ana, bea)
        one, _ = await _make_outfit(db_session, ana)
        two, _ = await _make_outfit(db_session, ana)

        r = await client.post(
            f"{API}/social/polls",
            json={"outfit_ids": [str(one.id), str(two.id)], "question": "  ¿Cena   con amigas? "},
            headers=_headers(ana),
        )
        assert r.status_code == 201, r.text
        poll = r.json()
        assert poll["question"] == "¿Cena con amigas?"
        assert [o["votes"] for o in poll["options"]] == [0, 0]  # the author sees counts

        summary = (await client.get(f"{API}/friends/summary", headers=_headers(bea))).json()
        assert summary["open_polls"] == 1

        seen = (await client.get(f"{API}/social/polls", headers=_headers(bea))).json()
        friend_poll = seen["friends"][0]
        assert friend_poll["id"] == poll["id"]
        assert all(o["votes"] is None for o in friend_poll["options"])  # no peeking first

        voted = await client.put(
            f"{API}/social/polls/{poll['id']}/vote",
            json={"outfit_id": str(two.id)},
            headers=_headers(bea),
        )
        assert voted.status_code == 200, voted.text
        assert voted.json()["my_vote"] == str(two.id)
        assert [o["votes"] for o in voted.json()["options"]] == [0, 1]
        changed = await client.put(
            f"{API}/social/polls/{poll['id']}/vote",
            json={"outfit_id": str(one.id)},
            headers=_headers(bea),
        )
        assert [o["votes"] for o in changed.json()["options"]] == [1, 0]
        assert changed.json()["total_votes"] == 1

        stranger = await client.put(
            f"{API}/social/polls/{poll['id']}/vote",
            json={"outfit_id": str(one.id)},
            headers=_headers(eve),
        )
        assert stranger.status_code == 404
        assert (await client.get(f"{API}/social/polls", headers=_headers(eve))).json()[
            "friends"
        ] == []

        mine = (await client.get(f"{API}/social/polls", headers=_headers(ana))).json()["mine"]
        assert mine["total_votes"] == 1 and mine["is_open"]

    async def test_only_own_looks_and_one_open_question(self, client, db_session):
        ana = await _make_user(db_session, "ana")
        bea = await _make_user(db_session, "bea")
        a1, _ = await _make_outfit(db_session, ana)
        a2, _ = await _make_outfit(db_session, ana)
        b1, _ = await _make_outfit(db_session, bea)
        bad = await client.post(
            f"{API}/social/polls",
            json={"outfit_ids": [str(a1.id), str(b1.id)]},
            headers=_headers(ana),
        )
        assert bad.status_code == 404
        same = await client.post(
            f"{API}/social/polls",
            json={"outfit_ids": [str(a1.id), str(a1.id)]},
            headers=_headers(ana),
        )
        assert same.status_code == 400
        first = await client.post(
            f"{API}/social/polls",
            json={"outfit_ids": [str(a1.id), str(a2.id)]},
            headers=_headers(ana),
        )
        second = await client.post(
            f"{API}/social/polls",
            json={"outfit_ids": [str(a2.id), str(a1.id)]},
            headers=_headers(ana),
        )
        assert first.status_code == second.status_code == 201
        mine = (await client.get(f"{API}/social/polls", headers=_headers(ana))).json()["mine"]
        assert mine["id"] == second.json()["id"]
        gone = await client.delete(f"{API}/social/polls/{mine['id']}", headers=_headers(bea))
        assert gone.status_code == 404
        assert (
            await client.delete(f"{API}/social/polls/{mine['id']}", headers=_headers(ana))
        ).status_code == 204
