"""GDPR account deletion: request endpoint (guards) + background job (rows + files)."""

import hashlib
import secrets
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import admin as admin_api
from app.config import get_settings
from app.models.admin import AccountDeletion, AdminAuditLog, FeedbackReport
from app.models.family import Family, FamilyInvite
from app.models.item import ClothingItem, WashHistory
from app.models.magic_link import MagicLinkToken
from app.models.outfit import Outfit
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.models.user_ai_settings import UserAISettings
from app.services.account_deletion import email_sha256, run_account_deletion
from tests.test_admin_panel import ADMIN_PREFIX, headers_for, make_user


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession, monkeypatch) -> User:
    uid = uuid.uuid4()
    email = f"admin-{uid}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", email)
    return await make_user(db_session, id=uid, email=email, username=f"adm{uid.hex[:8]}")


@pytest.fixture
def enqueued(monkeypatch) -> list[uuid.UUID]:
    calls: list[uuid.UUID] = []

    async def fake_enqueue(deletion_id):
        calls.append(deletion_id)

    monkeypatch.setattr(admin_api, "enqueue_account_deletion", fake_enqueue)
    return calls


async def _populate(db: AsyncSession, user: User, other: User) -> None:
    """Rows in (almost) every table that references a user."""
    item = ClothingItem(user_id=user.id, type="shirt", image_path=f"{user.id}/a.jpg")
    db.add(item)
    await db.flush()
    db.add(WashHistory(item_id=item.id, washed_at=date.today()))
    db.add(Outfit(user_id=user.id, occasion="casual"))
    db.add(UserAISettings(user_id=user.id, ai_access="platform", requests_this_month=3))
    db.add(
        SpotifyConnection(
            user_id=user.id,
            spotify_user_id="sp",
            access_token_ct=b"x",
            refresh_token_ct=b"y",
            access_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    # Pre-signup magic link (email only) + one bound to the user
    for uid in (None, user.id):
        db.add(
            MagicLinkToken(
                id=uuid.uuid4(),
                user_id=uid,
                email=user.email,
                token_hash=hashlib.sha256(secrets.token_bytes(16)).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(minutes=5),
            )
        )
    # Family created by the user, with another member (-> ownership handed over),
    # and an invite sent by the user (FK without ON DELETE).
    family = Family(name="Fam", created_by=user.id, invite_code=secrets.token_hex(5))
    db.add(family)
    await db.flush()
    user.family_id = family.id
    other.family_id = family.id
    db.add(
        FamilyInvite(
            family_id=family.id,
            email="x@example.com",
            token=secrets.token_hex(16),
            invited_by=user.id,
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    db.add(
        FeedbackReport(
            user_id=user.id,
            kind="bug",
            text="se rompe",
            screenshot_path=f"{user.id}/feedback/s.png",
        )
    )
    await db.commit()


class TestRequest:
    async def test_refuses_self(self, client, admin_user, enqueued):
        r = await client.post(
            f"{ADMIN_PREFIX}/users/{admin_user.id}/delete",
            json={"confirm": admin_user.username},
            headers=headers_for(admin_user),
        )
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "cannot_delete_self"
        assert enqueued == []

    async def test_refuses_other_site_admin(
        self, client, db_session, admin_user, enqueued, monkeypatch
    ):
        other_admin = await make_user(db_session, username=f"oa{uuid.uuid4().hex[:6]}")
        monkeypatch.setattr(
            get_settings(), "admin_emails", f"{admin_user.email},{other_admin.email}"
        )
        r = await client.post(
            f"{ADMIN_PREFIX}/users/{other_admin.id}/delete",
            json={"confirm": other_admin.username},
            headers=headers_for(admin_user),
        )
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "cannot_delete_admin"
        assert enqueued == []

    async def test_confirmation_must_match_username(self, client, db_session, admin_user, enqueued):
        target = await make_user(db_session, username=f"t{uuid.uuid4().hex[:8]}")
        r = await client.post(
            f"{ADMIN_PREFIX}/users/{target.id}/delete",
            json={"confirm": "someone-else"},
            headers=headers_for(admin_user),
        )
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "confirm_mismatch"
        assert enqueued == []

    async def test_accepted_request_is_queued_audited_and_locks_account(
        self, client, db_session, admin_user, enqueued
    ):
        target = await make_user(db_session, username=f"t{uuid.uuid4().hex[:8]}")
        r = await client.post(
            f"{ADMIN_PREFIX}/users/{target.id}/delete",
            json={"confirm": f"@{target.username.upper()}"},
            headers=headers_for(admin_user),
        )
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert enqueued == [uuid.UUID(body["id"])]
        await db_session.refresh(target)
        assert target.is_active is False  # locked until the worker runs
        log = (
            await db_session.execute(
                select(AdminAuditLog).where(
                    AdminAuditLog.action == "user.delete_requested",
                    AdminAuditLog.target_user_id == target.id,
                )
            )
        ).scalar_one()
        assert log.admin_id == admin_user.id


class TestJob:
    async def test_job_removes_rows_and_files(
        self, client, db_session, admin_user, enqueued, tmp_path
    ):
        target = await make_user(db_session, username=f"t{uuid.uuid4().hex[:8]}")
        heir = await make_user(db_session)
        await _populate(db_session, target, heir)
        user_dir = tmp_path / str(target.id)
        (user_dir / "feedback").mkdir(parents=True)
        (user_dir / "a.jpg").write_bytes(b"x" * 10)
        (user_dir / "feedback" / "s.png").write_bytes(b"y" * 5)
        untouched = tmp_path / str(heir.id)
        untouched.mkdir()
        (untouched / "keep.jpg").write_bytes(b"k")

        r = await client.post(
            f"{ADMIN_PREFIX}/users/{target.id}/delete",
            json={"confirm": target.username},
            headers=headers_for(admin_user),
        )
        deletion_id = uuid.UUID(r.json()["id"])
        email = target.email
        target_id = target.id
        db_session.expunge_all()

        deletion = await run_account_deletion(db_session, deletion_id, storage_path=str(tmp_path))
        assert deletion.status == "done", deletion.error
        assert deletion.completed_at is not None
        assert deletion.email_sha256 == email_sha256(email)
        assert deletion.summary["files_deleted"] == 2
        assert deletion.summary["families_reassigned"] == 1
        assert deletion.summary["tables"]["clothing_items.user_id"] == 1

        # No row anywhere still points at the user.
        fks = (
            await db_session.execute(
                text(
                    "SELECT cl.relname, att.attname FROM pg_constraint con "
                    "JOIN pg_class cl ON cl.oid = con.conrelid "
                    "JOIN pg_attribute att ON att.attrelid = con.conrelid "
                    "AND att.attnum = con.conkey[1] "
                    "WHERE con.contype = 'f' AND con.confrelid = 'users'::regclass"
                )
            )
        ).all()
        assert fks
        for table, column in fks:
            n = (
                await db_session.execute(
                    text(f'SELECT count(*) FROM "{table}" WHERE "{column}" = :u'), {"u": target_id}
                )
            ).scalar_one()
            assert n == 0, (table, column)
        assert (await db_session.get(User, target_id)) is None
        tokens = (
            await db_session.execute(
                select(func.count(MagicLinkToken.id)).where(MagicLinkToken.email == email)
            )
        ).scalar_one()
        assert tokens == 0
        assert (
            await db_session.execute(
                select(func.count(FeedbackReport.id)).where(FeedbackReport.user_id == target_id)
            )
        ).scalar_one() == 0

        # Family handed over to the remaining member, who keeps their data.
        family = (
            await db_session.execute(select(Family).where(Family.created_by == heir.id))
        ).scalar_one()
        assert family is not None
        assert (await db_session.get(User, heir.id)).family_id == family.id
        assert not user_dir.exists()
        assert (untouched / "keep.jpg").exists()

        # Tombstone survives; audit trail survives.
        tomb = await db_session.get(AccountDeletion, deletion_id)
        assert tomb.user_id == target_id

        # Re-running is a no-op.
        again = await run_account_deletion(db_session, deletion_id, storage_path=str(tmp_path))
        assert again.status == "done"

    async def test_job_deletes_sole_member_family(self, db_session, admin_user, tmp_path):
        target = await make_user(db_session, username=f"t{uuid.uuid4().hex[:8]}")
        family = Family(name="Solo", created_by=target.id, invite_code=secrets.token_hex(5))
        db_session.add(family)
        await db_session.flush()
        target.family_id = family.id
        await db_session.commit()
        family_id = family.id
        deletion = AccountDeletion(
            user_id=target.id, email_sha256=email_sha256(target.email), requested_by=admin_user.id
        )
        db_session.add(deletion)
        await db_session.commit()
        db_session.expunge_all()

        result = await run_account_deletion(db_session, deletion.id, storage_path=str(tmp_path))
        assert result.status == "done", result.error
        assert result.summary["families_deleted"] == 1
        assert await db_session.get(Family, family_id) is None

    async def test_job_refuses_site_admin(self, db_session, admin_user, tmp_path):
        """Defense in depth: even if a row slipped in, the job never deletes an admin."""
        deletion = AccountDeletion(
            user_id=admin_user.id,
            email_sha256=email_sha256(admin_user.email),
            requested_by=admin_user.id,
        )
        db_session.add(deletion)
        await db_session.commit()
        result = await run_account_deletion(db_session, deletion.id, storage_path=str(tmp_path))
        assert result.status == "failed"
        assert "Site admins" in result.error
        assert await db_session.get(User, admin_user.id) is not None

    async def test_list_and_retry(self, client, db_session, admin_user, enqueued, tmp_path):
        deletion = AccountDeletion(
            user_id=uuid.uuid4(),
            email_sha256="0" * 64,
            requested_by=admin_user.id,
            status="failed",
            error="boom",
        )
        db_session.add(deletion)
        await db_session.commit()
        r = await client.get(f"{ADMIN_PREFIX}/deletions", headers=headers_for(admin_user))
        assert any(d["id"] == str(deletion.id) for d in r.json())
        r = await client.post(
            f"{ADMIN_PREFIX}/deletions/{deletion.id}/retry", headers=headers_for(admin_user)
        )
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
        assert enqueued == [deletion.id]
        # A missing user (already gone) completes the tombstone.
        done = await run_account_deletion(db_session, deletion.id, storage_path=str(tmp_path))
        assert done.status == "done"
