from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    affiliation = Column(String, nullable=True)
    avatar_path = Column(String, nullable=True)
    is_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    copies = relationship("Copy", back_populates="user")


class AuthToken(Base):
    __tablename__ = "auth_tokens"

    token = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Paper(Base):
    """The canonical paper, keyed by DOI (or title when no DOI).
    One row per paper, holding the one shared PDF; per-reader state lives
    in Copy."""
    __tablename__ = "papers"

    id = Column(Integer, primary_key=True, index=True)
    doi = Column(Text, nullable=True)
    title = Column(Text, nullable=False)
    authors = Column(Text, nullable=True)  # JSON array stored as text
    journal = Column(Text, nullable=True)
    year = Column(Integer, nullable=True)
    file_path = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    copies = relationship("Copy", back_populates="paper", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="paper", cascade="all, delete-orphan")


class Copy(Base):
    """A reader's copy of a paper in their nook: ratings, summary, display."""
    __tablename__ = "copies"
    __table_args__ = (UniqueConstraint("paper_id", "user_id", name="uq_copy"),)

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    summary = Column(Text, nullable=True)  # private
    thought = Column(Text, nullable=True)  # public one-sentence take
    marketed = Column(Boolean, nullable=False, default=True, server_default="1")
    rating_expertise = Column(Integer, nullable=True)
    rating_reading = Column(Integer, nullable=True)
    rating_liking = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    paper = relationship("Paper", back_populates="copies")
    user = relationship("User", back_populates="copies")


class Comment(Base):
    """A reader's private note on a paper."""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    paper = relationship("Paper", back_populates="comments")
    user = relationship("User")


class Room(Base):
    """A seminar cohort for a paper (keyed like the paper)."""
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    paper_key = Column(String, nullable=False, index=True)
    paper_title = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    leader_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String, nullable=False, default="open")  # open | planning | scheduled | finished
    scheduled_time = Column(Text, nullable=True)
    platform = Column(Text, nullable=True)
    style = Column(String, nullable=True)  # preset key or a custom title
    style_desc = Column(Text, nullable=True)  # custom style's description
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User", foreign_keys=[created_by])
    leader = relationship("User", foreign_keys=[leader_id])
    participants = relationship("RoomParticipant", back_populates="room", cascade="all, delete-orphan")
    messages = relationship("RoomMessage", back_populates="room", cascade="all, delete-orphan")
    availabilities = relationship(
        "RoomAvailability", back_populates="room", cascade="all, delete-orphan"
    )


class RoomParticipant(Base):
    __tablename__ = "room_participants"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_participant"),)

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room = relationship("Room", back_populates="participants")
    user = relationship("User")


class RoomMessage(Base):
    __tablename__ = "room_messages"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room = relationship("Room", back_populates="messages")
    user = relationship("User")


class RoomAvailability(Base):
    __tablename__ = "room_availabilities"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_availability"),)

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    availability = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room = relationship("Room", back_populates="availabilities")
    user = relationship("User")


class Setting(Base):
    """App configuration kept in the database (e.g. SMTP credentials),
    editable through the admin tables page."""
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)


class ErrorLog(Base):
    """An unhandled server error, kept for the admin to inspect."""
    __tablename__ = "error_logs"

    id = Column(Integer, primary_key=True, index=True)
    method = Column(String, nullable=True)
    path = Column(Text, nullable=True)
    message = Column(Text, nullable=False)
    traceback = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    content = Column(Text, nullable=False)
    read = Column(Boolean, nullable=False, default=False)
    emailed = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
