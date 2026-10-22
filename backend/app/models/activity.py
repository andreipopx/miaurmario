"""One row per user per day they used the app: the only thing the funnel needs.

No events, no paths, no device: just "came back on this day", which is what
answers whether people return. Written at most once a day per user (a Redis key
guards the insert), so it costs nothing per request.
"""

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserActivityDay(Base):
    __tablename__ = "user_activity_days"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
