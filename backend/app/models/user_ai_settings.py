"""Per-user AI access settings (free plan / platform grant / bring-your-own-key)."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

AI_ACCESS_NONE = "none"
AI_ACCESS_PLATFORM = "platform"
AI_ACCESS_BYOK = "byok"
AI_ACCESS_VALUES = (AI_ACCESS_NONE, AI_ACCESS_PLATFORM, AI_ACCESS_BYOK)


class UserAISettings(Base):
    """One row per user; a missing row means ``ai_access == "none"``.

    Kept out of ``users`` on purpose: the users row is loaded on every request
    (get_current_user) and this table holds a ciphered secret plus usage
    counters that are written after every AI call. Only the API key is
    Fernet-ciphered (``byok_api_key_ct``); provider/base_url/models are not
    secrets and are shown back to the user.
    """

    __tablename__ = "user_ai_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    ai_access: Mapped[str] = mapped_column(
        String(16), nullable=False, default=AI_ACCESS_NONE, server_default=AI_ACCESS_NONE
    )

    # Bring-your-own-key provider config
    byok_provider: Mapped[str | None] = mapped_column(String(50))
    byok_base_url: Mapped[str | None] = mapped_column(String(500))
    byok_api_key_ct: Mapped[bytes | None] = mapped_column(LargeBinary)
    byok_api_key_last4: Mapped[str | None] = mapped_column(String(4))
    byok_vision_model: Mapped[str | None] = mapped_column(String(100))
    byok_text_model: Mapped[str | None] = mapped_column(String(100))
    byok_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Platform grant quota (None = unlimited). Only applies to ai_access == "platform".
    monthly_request_cap: Mapped[int | None] = mapped_column(Integer)

    # Usage counters, lazily reset when usage_month ("YYYY-MM", UTC) changes.
    usage_month: Mapped[str | None] = mapped_column(String(7))
    requests_this_month: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    tokens_this_month: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    # Split of tokens_this_month when the provider reports it (prompt = input,
    # completion = output); tokens without a split stay only in the total.
    prompt_tokens_this_month: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    completion_tokens_this_month: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
