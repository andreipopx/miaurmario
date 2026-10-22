"""«¿Cuál me pongo?»: two or three of your looks, and your friends vote."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LookPoll(Base):
    """A question to friends about which look to wear. Open until ``closes_at``.

    The looks stay private: friends see them through the poll only, never in the
    feed or on the profile.
    """

    __tablename__ = "look_polls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question: Mapped[str | None] = mapped_column(String(140))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user = relationship("User")
    options: Mapped[list["LookPollOption"]] = relationship(
        back_populates="poll", cascade="all, delete-orphan", order_by="LookPollOption.position"
    )
    votes: Mapped[list["LookPollVote"]] = relationship(
        back_populates="poll", cascade="all, delete-orphan"
    )


class LookPollOption(Base):
    __tablename__ = "look_poll_options"

    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("look_polls.id", ondelete="CASCADE"), primary_key=True
    )
    outfit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("outfits.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    poll: Mapped[LookPoll] = relationship(back_populates="options")
    outfit = relationship("Outfit")


class LookPollVote(Base):
    """One vote per friend per poll; voting again changes it."""

    __tablename__ = "look_poll_votes"

    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("look_polls.id", ondelete="CASCADE"), primary_key=True
    )
    voter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    outfit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("outfits.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    poll: Mapped[LookPoll] = relationship(back_populates="votes")
