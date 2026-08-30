from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, ForeignKey, UniqueConstraint, Table
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base


copy_tags = Table(
    "copy_tags",
    Base.metadata,
    Column("copy_id", Integer, ForeignKey("copies.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    affiliation = Column(String, nullable=True)
    avatar_path = Column(String, nullable=True)
    # Readers may show their email on their nook; on by default.
    email_public = Column(Boolean, nullable=False, default=True, server_default="1")
    is_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # A closed account. The row stays as a tombstone: a seminar someone
    # started and the messages they left in it point at this row, and those
    # belong to the readers who were there as much as to the one who left.
    # Everything that identified the reader is scrubbed when it is set —
    # see account.tombstone() — so what remains is a shape, not a person.
    deleted_at = Column(DateTime, nullable=True)

    copies = relationship("Copy", back_populates="user")
    tags = relationship("Tag", back_populates="user", cascade="all, delete-orphan")
    shelves = relationship("Shelf", back_populates="user", cascade="all, delete-orphan", order_by="Shelf.position")
    boards = relationship("Board", back_populates="owner", cascade="all, delete-orphan")

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class AuthToken(Base):
    """A sign-in session. The row outlives the session: signing out stamps
    revoked_at instead of deleting, so the record of who came back, and
    when, survives."""
    __tablename__ = "auth_tokens"

    token = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # The last authenticated request made with this session. Signing in is
    # itself a use, so it starts at the creation time.
    last_used_at = Column(DateTime, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User")


class PresencePing(Base):
    """One reader heartbeat per minute, retained for concurrency history."""
    __tablename__ = "presence_pings"
    __table_args__ = (
        UniqueConstraint("user_id", "bucket_at", name="uq_presence_user_bucket"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bucket_at = Column(DateTime, nullable=False, index=True)


class Paper(Base):
    """The canonical paper, keyed by DOI (or title when no DOI). One row
    per paper; its PDFs are its editions, and per-reader state lives in
    Copy."""
    __tablename__ = "papers"

    id = Column(Integer, primary_key=True, index=True)
    doi = Column(Text, nullable=True)
    title = Column(Text, nullable=False)
    authors = Column(Text, nullable=True)  # JSON array stored as text
    journal = Column(Text, nullable=True)
    year = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    copies = relationship("Copy", back_populates="paper", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="paper", cascade="all, delete-orphan")
    editions = relationship(
        "PaperEdition", back_populates="paper", order_by="PaperEdition.id"
    )


class PaperEdition(Base):
    """One PDF file of a paper. A re-upload adds an edition instead of
    replacing the file, so no reader's copy changes under them; each
    reader's copy names the edition they read (Copy.edition_id).
    Editions and their files are never deleted automatically."""
    __tablename__ = "paper_editions"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)
    file_path = Column(Text, nullable=False)
    # Content hash: an upload identical to an existing edition reuses it
    # rather than adding a duplicate.
    sha256 = Column(String, nullable=True, index=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # How far the reference analysis of this PDF has got. References are
    # a property of the file, not of the paper, so they are read once per
    # edition and kept: pending | ready | failed | unavailable.
    references_status = Column(String, nullable=True)
    references_error = Column(Text, nullable=True)
    references_at = Column(DateTime, nullable=True)

    paper = relationship("Paper", back_populates="editions")
    uploader = relationship("User")
    references = relationship(
        "EditionReference",
        back_populates="edition",
        cascade="all, delete-orphan",
        order_by="EditionReference.index",
    )
    citations = relationship(
        "EditionCitation", back_populates="edition", cascade="all, delete-orphan"
    )
    links = relationship(
        "EditionLink", back_populates="edition", cascade="all, delete-orphan"
    )


class EditionReference(Base):
    """One work cited by an edition, as the analyzer read it off the page.

    `raw` is the reference exactly as printed — the string a bibliographic
    search matches against, and the thing to show a reader when no match is
    found. Everything under `resolved_*` is what the lookup added, filled
    in the first time someone opens this reference and kept thereafter."""
    __tablename__ = "edition_references"

    id = Column(Integer, primary_key=True, index=True)
    edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=False, index=True)
    # The analyzer's own id for the entry (its xml:id), which is what the
    # in-text markers point at.
    key = Column(String, nullable=False)
    index = Column(Integer, nullable=False)
    raw = Column(Text, nullable=True)
    title = Column(Text, nullable=True)
    authors = Column(Text, nullable=True)  # JSON array stored as text
    year = Column(Integer, nullable=True)
    journal = Column(Text, nullable=True)
    doi = Column(Text, nullable=True)
    arxiv_id = Column(Text, nullable=True)
    # Where the entry is printed in the bibliography, as fractions of the
    # page: a PDF's own citation links point at a place on a page, and this
    # is what lets such a link be matched to the entry it lands on.
    page = Column(Integer, nullable=True)
    y = Column(Float, nullable=True)

    # The lookup: none | ok | miss | error.
    resolved_status = Column(String, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolution = Column(Text, nullable=True)  # JSON blob, see biblio.resolve

    edition = relationship("PaperEdition", back_populates="references")


class EditionCitation(Base):
    """One in-text marker — the "[12]" a reader clicks — and its box.

    The box is fractions of the page from its top-left corner, so it lands
    in the same place at any zoom and on any screen. A marker that names
    several works, "[3, 5]", is several rows: each is separately clickable
    because each leads somewhere different."""
    __tablename__ = "edition_citations"

    id = Column(Integer, primary_key=True, index=True)
    edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=False, index=True)
    reference_id = Column(Integer, ForeignKey("edition_references.id"), nullable=True)
    label = Column(Text, nullable=True)
    page = Column(Integer, nullable=False, index=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)
    # The analyzer found the marker but not what it pointed at, and the
    # number printed in it was read instead. A guess, and marked as one.
    inferred = Column(Boolean, default=False)

    edition = relationship("PaperEdition", back_populates="citations")
    reference = relationship("EditionReference")


class EditionLink(Base):
    """One analyzed cross-reference to another position in the PDF."""
    __tablename__ = "edition_links"

    id = Column(Integer, primary_key=True, index=True)
    edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    label = Column(Text, nullable=True)
    page = Column(Integer, nullable=False, index=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)
    target_page = Column(Integer, nullable=False)
    target_y = Column(Float, nullable=False)

    edition = relationship("PaperEdition", back_populates="links")


class Copy(Base):
    """A reader's copy of a paper in their nook: ratings, summary, display."""
    __tablename__ = "copies"
    __table_args__ = (UniqueConstraint("paper_id", "user_id", name="uq_copy"),)

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    shelf_id = Column(Integer, ForeignKey("shelves.id"), nullable=True, index=True)
    # The edition this reader reads. Only the reader moves it, by adopting
    # a newer one; nothing else may change the file under their notes.
    edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=True)
    # Durable identity of those exact PDF bytes. The integer remains an
    # internal join key for edition-owned analysis; a reader's choice is the
    # content hash, which survives row renumbering and names the viewer URL.
    edition_sha256 = Column(String, nullable=True, index=True)
    # The newest edition this reader has already seen — waved away, or
    # simply present when they last chose a PDF. The offer of a newer PDF
    # stays hidden until one newer still arrives.
    ignored_edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=True)
    summary = Column(Text, nullable=True)  # private
    thought = Column(Text, nullable=True)  # public one-sentence take
    marketed = Column(Boolean, nullable=False, default=True, server_default="1")
    # The reader is an author of this paper ("this is my paper").
    is_author = Column(Boolean, nullable=False, default=False, server_default="0")
    rating_expertise = Column(Integer, nullable=True)
    rating_reading = Column(Integer, nullable=True)
    rating_liking = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    paper = relationship("Paper", back_populates="copies")
    user = relationship("User", back_populates="copies")
    edition = relationship("PaperEdition", foreign_keys=[edition_id])
    tags = relationship("Tag", secondary=copy_tags, back_populates="copies")
    shelf = relationship("Shelf", back_populates="copies")


class Shelf(Base):
    """One of a reader's five homes for papers. Visibility belongs to the
    shelf; Copy.marketed is kept in sync for compatibility with seminar rules."""
    __tablename__ = "shelves"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_shelf_user_name"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(40), nullable=False)
    color = Column(String(7), nullable=False)
    is_public = Column(Boolean, nullable=False, default=False, server_default="0")
    is_default = Column(Boolean, nullable=False, default=False, server_default="0")
    position = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="shelves")
    copies = relationship("Copy", back_populates="shelf")
    boards = relationship("Board", back_populates="shelf")


class Tag(Base):
    """A private label in one reader's nook."""
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tag_user_name"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(60), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="tags")
    copies = relationship("Copy", secondary=copy_tags, back_populates="tags")


class Comment(Base):
    """A reader's private note on a paper. A note may be *located*: fixed to
    a place in the PDF, in which case it carries a page, a typed anchor and
    the edition it was placed on. A note without those is the same kind of
    thing, just not pinned anywhere."""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Empty while an anchor is only a mark, before anything is written.
    content = Column(Text, nullable=False, default="")
    # Location, all null for a note that is not pinned to the page.
    edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=True)
    page = Column(Integer, nullable=True)
    # `point` today; `rect`, `polygon` and `quote` later, each with its own
    # shape in `anchor` (JSON). A point is {"x": 0.42, "y": 0.71}: fractions
    # of the page in PDF user space, so zoom and DPI never enter it.
    anchor_type = Column(String, nullable=True)
    anchor = Column(Text, nullable=True)
    # What the reader calls this anchor; the page number stands in when
    # they have not named it.
    name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    paper = relationship("Paper", back_populates="comments")
    user = relationship("User")
    edition = relationship("PaperEdition")


class Board(Base):
    """A private ideation space inside one reader's nook."""
    __tablename__ = "boards"

    id = Column(Integer, primary_key=True, index=True)
    guid = Column(String(36), unique=True, nullable=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    shelf_id = Column(Integer, ForeignKey("shelves.id"), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="boards")
    shelf = relationship("Shelf", back_populates="boards")
    items = relationship(
        "BoardItem", back_populates="board", cascade="all, delete-orphan",
        order_by="BoardItem.created_at",
    )
    groups = relationship(
        "BoardGroup", back_populates="board", cascade="all, delete-orphan",
        order_by="BoardGroup.created_at",
    )


class BoardGroup(Base):
    """A visual and behavioral grouping of items on a board."""
    __tablename__ = "board_groups"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False, default="chapter", server_default="chapter")
    title = Column(String(240), nullable=False)
    header = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    board = relationship("Board", back_populates="groups")
    items = relationship("BoardItem", back_populates="group")


class BoardItem(Base):
    """A note or uploaded file collected on a board."""
    __tablename__ = "board_items"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("board_groups.id"), nullable=True, index=True)
    kind = Column(String(20), nullable=False)  # comment | image | file | youtube | webpage
    content = Column(Text, nullable=True)
    file_path = Column(Text, nullable=True)
    original_filename = Column(Text, nullable=True)
    mime_type = Column(String(255), nullable=True)
    source_url = Column(Text, nullable=True)
    text_align = Column(String(10), nullable=False, default="left", server_default="left")
    position = Column(Integer, nullable=False, default=0, server_default="0")
    x = Column(Float, nullable=False, default=0, server_default="0")
    y = Column(Float, nullable=False, default=0, server_default="0")
    width = Column(Float, nullable=False, default=300, server_default="300")
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    board = relationship("Board", back_populates="items")
    group = relationship("BoardGroup", back_populates="items")


class InkStroke(Base):
    """One freehand mark a reader drew on a page.

    Ink belongs to an edition rather than to a paper, for the same reason a
    located note does: it was drawn over a particular PDF, and a different
    file has different pages. It is private to the reader who drew it, as
    notes are.

    `points` is a JSON array of {"x": …, "y": …}, each a fraction of the
    page in PDF user space with y measured from the bottom — the same
    coordinates a note's anchor uses, so zoom, DPI and screen size never
    enter it. `width` is a fraction of the page width for the same reason:
    a stroke drawn at 100% is the same weight when read at 250%.
    """
    __tablename__ = "ink_strokes"

    id = Column(Integer, primary_key=True, index=True)
    # Several stored paths can be one logical mark. Text selected across
    # lines must be rendered as separate paths, but it is still one brush
    # action when the reader moves or erases it.
    group_id = Column(String, nullable=True)
    edition_id = Column(Integer, ForeignKey("paper_editions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    page = Column(Integer, nullable=False, index=True)
    points = Column(Text, nullable=False)
    color = Column(String, nullable=False, default="#b3923d")
    width = Column(Float, nullable=False, default=0.004)
    # 1 is solid ink; less lets the words underneath show through, which is
    # what a reader wants when marking a line rather than crossing it out.
    # A server_default so that migrate() can add it to an existing table:
    # SQLite will not add a NOT NULL column without one.
    opacity = Column(Float, nullable=False, default=1.0, server_default="1.0")
    # The nib: "flat" is a chisel held upright, wide across the page and
    # thin along it, so the mark records the direction the hand went;
    # "round" is the same weight whichever way it is drawn.
    #
    # The server default is "round" and the client's is "flat": ink drawn
    # before there was a choice was drawn with a round nib, and should go on
    # looking the way it looked, while a stroke drawn today gets the nib the
    # brush now shows.
    shape = Column(String, nullable=False, default="flat", server_default="round")
    created_at = Column(DateTime, default=datetime.utcnow)

    edition = relationship("PaperEdition")
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


class Feedback(Base):
    """A bug report or feature request. Kept for the admins to work
    through; the reporter may be signed out, hence the nullable user."""
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    content = Column(Text, nullable=False)
    # Where the reporter was in the app, and how to reach them when they
    # have no account.
    page = Column(Text, nullable=True)
    contact = Column(String, nullable=True)
    resolved = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
