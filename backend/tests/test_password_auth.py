"""Optional password login, password management and sliding token refresh."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth as auth_module
from app.api.auth import create_access_token
from app.models.user import User
from app.utils import passwords
from app.utils.passwords import (
    PasswordPolicyError,
    hash_password,
    validate_new_password,
    verify_password,
)

LOGIN_URL = "/api/v1/auth/password/login"
PASSWORD_URL = "/api/v1/users/me/password"
REFRESH_URL = "/api/v1/auth/refresh"

GOOD_PASSWORD = "gatito-con-criterio-42"
_GOOD_HASH = hash_password(GOOD_PASSWORD)


@pytest.fixture(autouse=True)
def _password_settings(monkeypatch):
    monkeypatch.setattr(auth_module.settings, "password_login_enabled", True)
    monkeypatch.setattr(auth_module.settings, "admin_emails", "")
    return auth_module.settings


async def _make_user(
    db: AsyncSession,
    *,
    password: bool = True,
    username: str | None = None,
    active: bool = True,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        external_id=f"magic:pw-{uid.hex[:10]}@example.com",
        email=f"pw-{uid.hex[:10]}@example.com",
        username=username or f"pw_{uid.hex[:10]}",
        display_name="Password User",
        is_active=active,
        onboarding_completed=True,
        password_hash=_GOOD_HASH if password else None,
        password_updated_at=datetime.now(UTC) if password else None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


class TestPasswordPolicy:
    @pytest.mark.parametrize(
        ("password", "code"),
        [
            ("short1!", "password_too_short"),
            ("x" * 129, "password_too_long"),
            ("password123", "password_too_common"),
            ("Password2024!", "password_too_common"),
            ("qwertyuiop", "password_too_common"),
            ("contraseña123", "password_too_common"),
            ("aaaaaaaaaaaa", "password_too_common"),
            ("abababababab", "password_too_common"),
            ("abcdefghijkl", "password_too_common"),
            ("9876543210", "password_too_common"),
        ],
    )
    def test_rejects_weak(self, password: str, code: str):
        with pytest.raises(PasswordPolicyError) as exc:
            validate_new_password(password)
        assert exc.value.code == code

    def test_rejects_identity(self):
        with pytest.raises(PasswordPolicyError) as exc:
            validate_new_password("andreipop1987", identities=("AndreiPop@example.com",))
        assert exc.value.code == "password_matches_identity"

    @pytest.mark.parametrize(
        "password", ["gatito-con-criterio-42", "correct horse battery", "x" * 3 + "Yz9!kq2Lm"]
    )
    def test_accepts_reasonable(self, password: str):
        validate_new_password(password, identities=("someone@example.com", "someone"))

    def test_hash_roundtrip_is_argon2id_and_untruncated(self):
        long_pw = "a1B2c3D4" * 12  # 96 chars: bcrypt would silently truncate at 72 bytes
        h = hash_password(long_pw)
        assert h.startswith("$argon2id$")
        assert verify_password(h, long_pw)
        assert not verify_password(h, long_pw[:72])
        assert not verify_password("not-a-hash", long_pw)


class TestPasswordLogin:
    async def test_login_with_email_case_insensitive(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session)
        resp = await client.post(
            LOGIN_URL, json={"identifier": f"  {user.email.upper()} ", "password": GOOD_PASSWORD}
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Same payload shape as magic-link verify.
        assert set(data) == {
            "id",
            "external_id",
            "email",
            "display_name",
            "username",
            "avatar_url",
            "is_new_user",
            "onboarding_completed",
            "needs_username",
            "access_token",
        }
        assert data["external_id"] == user.external_id
        assert data["is_new_user"] is False
        session = await client.get(
            "/api/v1/auth/session", headers={"Authorization": f"Bearer {data['access_token']}"}
        )
        assert session.status_code == 200
        assert session.json()["email"] == user.email

    async def test_login_with_username_case_insensitive(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session)
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.username.upper(), "password": GOOD_PASSWORD}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == str(user.id)

    async def test_login_updates_last_login(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        assert user.last_login_at is None
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": GOOD_PASSWORD}
        )
        assert resp.status_code == 200
        await db_session.refresh(user)
        assert user.last_login_at is not None

    async def test_wrong_password_generic_401(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": "wrong-password-123"}
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid credentials"

    async def test_unknown_user_burns_a_hash_and_gets_same_error(
        self, client: AsyncClient, monkeypatch
    ):
        calls: list[str] = []
        real = passwords.burn_verification

        def spy(pw: str) -> None:
            calls.append(pw)
            real(pw)

        monkeypatch.setattr(passwords, "burn_verification", spy)
        resp = await client.post(
            LOGIN_URL,
            json={"identifier": f"nobody-{uuid.uuid4().hex}@example.com", "password": "whatever-1"},
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid credentials"
        assert calls == ["whatever-1"]

    async def test_user_without_password_burns_a_hash_and_gets_same_error(
        self, client: AsyncClient, db_session: AsyncSession, monkeypatch
    ):
        user = await _make_user(db_session, password=False)
        calls: list[str] = []
        monkeypatch.setattr(passwords, "burn_verification", lambda pw: calls.append(pw))
        resp = await client.post(LOGIN_URL, json={"identifier": user.email, "password": "x" * 12})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid credentials"
        assert len(calls) == 1

    async def test_inactive_user_forbidden(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session, active=False)
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": GOOD_PASSWORD}
        )
        assert resp.status_code == 403

    async def test_inactive_user_wrong_password_is_still_generic(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session, active=False)
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": "wrong-password-123"}
        )
        assert resp.status_code == 401

    async def test_admin_promotion_on_password_login(
        self, client: AsyncClient, db_session: AsyncSession, monkeypatch
    ):
        user = await _make_user(db_session)
        monkeypatch.setattr(auth_module.settings, "admin_emails", f"x@example.com,{user.email}")
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.username, "password": GOOD_PASSWORD}
        )
        assert resp.status_code == 200
        user_id = user.id
        db_session.expire_all()
        refreshed = (await db_session.execute(select(User).where(User.id == user_id))).scalar_one()
        assert refreshed.role == "admin"

    async def test_login_never_demotes_family_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        # role="admin" also means *family* admin; ADMIN_EMAILS (empty here) only
        # decides site admin, so logging in must not strip the family role.
        user = await _make_user(db_session)
        user.role = "admin"
        await db_session.commit()
        user_id = user.id
        resp = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": GOOD_PASSWORD}
        )
        assert resp.status_code == 200
        db_session.expire_all()
        refreshed = (await db_session.execute(select(User).where(User.id == user_id))).scalar_one()
        assert refreshed.role == "admin"

    async def test_rate_limited_per_identifier(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        statuses = []
        for i in range(11):
            resp = await client.post(
                LOGIN_URL,
                json={"identifier": user.email, "password": "wrong-password-123"},
                # Different client IPs: only the per-identifier bucket can trip.
                headers={"X-Forwarded-For": f"198.51.100.{i + 1}"},
            )
            statuses.append(resp.status_code)
        assert statuses[:10] == [401] * 10
        assert statuses[10] == 429
        # Even the right password is refused while the identifier is locked.
        resp = await client.post(
            LOGIN_URL,
            json={"identifier": user.email.upper(), "password": GOOD_PASSWORD},
            headers={"X-Forwarded-For": "198.51.100.200"},
        )
        assert resp.status_code == 429

    async def test_rate_limited_per_ip(self, client: AsyncClient):
        statuses = []
        for i in range(11):
            resp = await client.post(
                LOGIN_URL,
                json={"identifier": f"spray-{i}@example.com", "password": "wrong-password-123"},
                headers={"X-Forwarded-For": "203.0.113.77, 172.18.0.5"},
            )
            statuses.append(resp.status_code)
        assert statuses[:10] == [401] * 10
        assert statuses[10] == 429
        # Another client IP is unaffected (first X-Forwarded-For hop is the client).
        other = await client.post(
            LOGIN_URL,
            json={"identifier": "spray-x@example.com", "password": "wrong-password-123"},
            headers={"X-Forwarded-For": "203.0.113.78, 172.18.0.5"},
        )
        assert other.status_code == 401

    async def test_disabled_by_setting(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr(auth_module.settings, "password_login_enabled", False)
        resp = await client.post(
            LOGIN_URL, json={"identifier": "a@example.com", "password": "whatever-123"}
        )
        assert resp.status_code == 503

    async def test_auth_config_advertises_password(self, client: AsyncClient):
        resp = await client.get("/api/v1/auth/config")
        assert resp.json()["password"] == {"enabled": True}


class TestPasswordManagement:
    async def test_set_first_password_without_current(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session, password=False)
        me = await client.get("/api/v1/users/me", headers=_headers(user))
        assert me.json()["has_password"] is False

        resp = await client.put(
            PASSWORD_URL, json={"new_password": GOOD_PASSWORD}, headers=_headers(user)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["has_password"] is True

        me = await client.get("/api/v1/users/me", headers=_headers(user))
        assert me.json()["has_password"] is True
        assert me.json()["password_updated_at"]

        login = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": GOOD_PASSWORD}
        )
        assert login.status_code == 200

    async def test_change_requires_current(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        resp = await client.put(
            PASSWORD_URL, json={"new_password": "otra-clave-segura-99"}, headers=_headers(user)
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "current_password_required"

        resp = await client.put(
            PASSWORD_URL,
            json={"current_password": "nope-nope-nope", "new_password": "otra-clave-segura-99"},
            headers=_headers(user),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "current_password_invalid"

    async def test_change_with_current(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        resp = await client.put(
            PASSWORD_URL,
            json={"current_password": GOOD_PASSWORD, "new_password": "otra-clave-segura-99"},
            headers=_headers(user),
        )
        assert resp.status_code == 200
        old = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": GOOD_PASSWORD}
        )
        assert old.status_code == 401
        new = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": "otra-clave-segura-99"}
        )
        assert new.status_code == 200

    @pytest.mark.parametrize(
        ("password", "code"),
        [
            ("corta", "password_too_short"),
            ("y" * 129, "password_too_long"),
            ("iloveyou123", "password_too_common"),
        ],
    )
    async def test_policy_errors(
        self, client: AsyncClient, db_session: AsyncSession, password: str, code: str
    ):
        user = await _make_user(db_session, password=False)
        resp = await client.put(
            PASSWORD_URL, json={"new_password": password}, headers=_headers(user)
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == code

    async def test_password_matching_username_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session, password=False, username=f"mm{uuid.uuid4().hex[:10]}")
        resp = await client.put(
            PASSWORD_URL, json={"new_password": user.username + "2024"}, headers=_headers(user)
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "password_matches_identity"

    async def test_remove_password(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        resp = await client.delete(PASSWORD_URL, headers=_headers(user))
        assert resp.status_code == 204
        me = await client.get("/api/v1/users/me", headers=_headers(user))
        assert me.json()["has_password"] is False
        login = await client.post(
            LOGIN_URL, json={"identifier": user.email, "password": GOOD_PASSWORD}
        )
        assert login.status_code == 401
        # Idempotent.
        again = await client.delete(PASSWORD_URL, headers=_headers(user))
        assert again.status_code == 204

    async def test_requires_auth(self, client: AsyncClient):
        assert (
            await client.put(PASSWORD_URL, json={"new_password": GOOD_PASSWORD})
        ).status_code == 401
        assert (await client.delete(PASSWORD_URL)).status_code == 401


class TestRefresh:
    async def test_refresh_returns_fresh_token(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        old = create_access_token(user.external_id, expires_delta=timedelta(days=1))
        resp = await client.post(REFRESH_URL, headers={"Authorization": f"Bearer {old}"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["token_type"] == "bearer"
        assert body["expires_in"] == auth_module.settings.access_token_days * 86400
        claims = jwt.decode(
            body["access_token"], auth_module.settings.secret_key, algorithms=["HS256"]
        )
        assert claims["sub"] == user.external_id
        remaining = claims["exp"] - datetime.now(UTC).timestamp()
        assert remaining > (auth_module.settings.access_token_days - 1) * 86400

    async def test_refresh_rejects_expired_token(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session)
        expired = create_access_token(user.external_id, expires_delta=timedelta(seconds=-5))
        resp = await client.post(REFRESH_URL, headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401

    async def test_refresh_rejects_token_signed_with_other_key(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session)
        forged = jwt.encode(
            {"sub": user.external_id, "exp": datetime.now(UTC) + timedelta(days=1)},
            "rotated-secret-key-that-is-long-enough",
            algorithm="HS256",
        )
        resp = await client.post(REFRESH_URL, headers={"Authorization": f"Bearer {forged}"})
        assert resp.status_code == 401

    async def test_refresh_rejects_inactive_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        user = await _make_user(db_session, active=False)
        resp = await client.post(REFRESH_URL, headers=_headers(user))
        assert resp.status_code == 403

    async def test_refresh_requires_auth(self, client: AsyncClient):
        assert (await client.post(REFRESH_URL)).status_code == 401

    async def test_refresh_rate_limited(self, client: AsyncClient, db_session: AsyncSession):
        user = await _make_user(db_session)
        codes = [
            (await client.post(REFRESH_URL, headers=_headers(user))).status_code for _ in range(31)
        ]
        assert codes[:30] == [200] * 30
        assert codes[30] == 429

    def test_default_token_lifetime_follows_setting(self, monkeypatch):
        monkeypatch.setattr(auth_module.settings, "access_token_days", 30)
        token = create_access_token("magic:someone@example.com")
        claims = jwt.decode(token, auth_module.settings.secret_key, algorithms=["HS256"])
        assert claims["exp"] - claims["iat"] == 30 * 86400
