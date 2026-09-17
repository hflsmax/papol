from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, ForeignKey, UniqueConstraint, Table, LargeBinary, and_
from sqlalchemy.orm import relationship
from datetime import datetime
from uuid import uuid4
from database import Base


def new_uuid() -> str:
    return str(uuid4())


# Every row is named by a UUID, its primary key `uuid`. A reference to another
# row is `<name>_uuid` and holds that row's UUID.
def uuid_key():
    return Column(String(36), primary_key=True, default=new_uuid)


copy_tags = Table(
    "copy_tags",
    Base.metadata,
    Column("uuid", String(36), primary_key=True, default=new_uuid),
    Column("copy_uuid", String(36), ForeignKey("copies.uuid"), nullable=False, index=True),
    Column("tag_uuid", String(36), ForeignKey("tags.uuid"), nullable=False, index=True),
    Column("user_uuid", String(36), ForeignKey("users.uuid"), nullable=False, index=True),
    Column("created_at", DateTime, default=datetime.utcnow),
    Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow),
    Column("revision", Integer, nullable=False, default=0, server_default="0"),
    Column("deleted_at", DateTime, nullable=True),
    UniqueConstraint("copy_uuid", "tag_uuid", name="uq_copy_tag"),
)


class User(Base):
    __tablename__ = "users"

    uuid = uuid_key()
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    affiliation = Column(String, nullable=True)
    avatar_path = Column(String, nullable=True)
    # Users may show their email on their nook; on by default.
    email_public = Column(Boolean, nullable=False, default=True, server_default="1")
    is_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # A closed account. The row stays as a tombstone: a seminar someone
    # started and the messages they left in it point at this row, and those
    # belong to the users who were there as much as to the one who left.
    # Everything that identified the user is scrubbed when it is set —
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
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # The last authenticated request made with this session. Signing in is
    # itself a use, so it starts at the creation time.
    last_used_at = Column(DateTime, default=datetime.utcnow)
    # Which Papol this sign-in came from: "web" or "macos". Null on the
    # sessions that predate the record; nothing is inferred for them.
    platform = Column(String, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User")


class AppliedMutation(Base):
    """The durable result of one retryable desktop mutation.

    The unique caller identity makes a lost HTTP response safe to retry. The
    stored fingerprint also prevents accidentally reusing an identifier for a
    different operation.
    """
    __tablename__ = "applied_mutations"
    __table_args__ = (
        UniqueConstraint(
            "user_uuid", "client_uuid", "mutation_uuid",
            name="uq_applied_mutation_identity",
        ),
    )

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    client_uuid = Column(String(36), nullable=False)
    mutation_uuid = Column(String(36), nullable=False)
    request_hash = Column(String(64), nullable=False)
    method = Column(String(8), nullable=False)
    path = Column(Text, nullable=False)
    response_status = Column(Integer, nullable=False)
    response_content_type = Column(String(255), nullable=True)
    response_body = Column(LargeBinary, nullable=False, default=b"")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")


class ServerChange(Base):
    """One committed synchronized row version, ordered for cursor pulls.

    `sequence` is the pull cursor, not an identity: it only has to grow.

    Growing is the whole of what it has to do, and an ordinary SQLite
    integer key does not do it. A key that is the row id takes max(id) + 1
    of the rows that are *there*, so a log with entries removed from the end
    — an account closed, a merge dropping what it invalidated, a replica
    caught up and the entries it has taken let go of — hands the next change
    a number that has been used. Every replica past that number then never
    sees another change, because its cursor is already beyond them, and
    nothing anywhere reports a problem. AUTOINCREMENT is what makes SQLite
    remember the high-water mark instead.
    """
    __tablename__ = "_server_change_log"
    __table_args__ = {"sqlite_autoincrement": True}

    sequence = Column(Integer, primary_key=True, autoincrement=True)
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    table_name = Column(String(64), nullable=False)
    row_uuid = Column(String(36), nullable=False)
    revision = Column(Integer, nullable=False)
    operation = Column(String(10), nullable=False)
    row_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SyncClient(Base):
    """Last cursor durably acknowledged by one installed desktop client."""
    __tablename__ = "_server_clients"
    __table_args__ = (
        UniqueConstraint("user_uuid", "client_uuid", name="uq_server_sync_client"),
    )

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    client_uuid = Column(String(36), nullable=False)
    acknowledged_cursor = Column(Integer, nullable=False, default=0, server_default="0")
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # What this installation last announced itself as. Null for a client
    # that synchronized before Papol asked. Kept so a minimum version can be
    # raised against a known fleet rather than a guess: nobody should cut
    # off a build without first seeing how many users are still on it.
    app_version = Column(String(32), nullable=True)


class Paper(Base):
    """One PDF, and the metadata read off it.

    A paper *is* its file: the content hash is its identity. Two PDFs of
    the same work — a preprint and the published version, or the same
    article scanned twice — are two papers, even when they print the same
    DOI. Each has its own copies, annotations and bibliography, and
    nothing here belongs to anyone; per-user state lives in Copy."""
    __tablename__ = "papers"

    # The paper's identity, and the only one it has. A UUID here would be a
    # second name for a thing that already has one: the bytes say which
    # paper this is, and everyone who holds the file arrives at the same
    # answer without asking.
    sha256 = Column(String(64), primary_key=True)
    doi = Column(Text, nullable=True)
    title = Column(Text, nullable=False)
    authors = Column(Text, nullable=True)  # JSON array stored as text
    journal = Column(Text, nullable=True)
    year = Column(Integer, nullable=True)
    file_path = Column(Text, nullable=False)
    uploaded_by = Column(String(36), ForeignKey("users.uuid"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=1, server_default="1")
    deleted_at = Column(DateTime, nullable=True)

    # How far the reference analysis of this PDF has got. References are
    # a property of the file, so they are read once and kept:
    # pending | ready | failed | unavailable.
    references_status = Column(String, nullable=True)
    references_error = Column(Text, nullable=True)
    references_at = Column(DateTime, nullable=True)

    copies = relationship("Copy", back_populates="paper", cascade="all, delete-orphan")
    annotations = relationship(
        "Annotation", back_populates="paper", cascade="all, delete-orphan",
    )
    uploader = relationship("User")
    references = relationship(
        "PaperReference",
        back_populates="paper",
        cascade="all, delete-orphan",
        order_by="PaperReference.index",
    )
    citations = relationship(
        "PaperCitation", back_populates="paper", cascade="all, delete-orphan"
    )
    links = relationship(
        "PaperLink", back_populates="paper", cascade="all, delete-orphan"
    )


class PaperReference(Base):
    """One work cited by a paper, as the analyzer read it off the page.

    `raw` is the reference exactly as printed — the string a bibliographic
    search matches against, and the thing to show a user when no match is
    found. Everything under `resolved_*` is what the lookup added, filled
    in the first time someone opens this reference and kept thereafter."""
    __tablename__ = "paper_references"

    uuid = uuid_key()
    paper_sha256 = Column(String(64), ForeignKey("papers.sha256"), nullable=False, index=True)
    # The analyzer's own key for the entry (its xml:id), which is what the
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

    paper = relationship("Paper", back_populates="references")


class PaperCitation(Base):
    """One in-text marker — the "[12]" a user clicks — and its box.

    The box is fractions of the page from its top-left corner, so it lands
    in the same place at any zoom and on any screen. A marker that names
    several works, "[3, 5]", is several rows: each is separately clickable
    because each leads somewhere different."""
    __tablename__ = "paper_citations"

    uuid = uuid_key()
    paper_sha256 = Column(String(64), ForeignKey("papers.sha256"), nullable=False, index=True)
    reference_uuid = Column(String(36), ForeignKey("paper_references.uuid"), nullable=True)
    label = Column(Text, nullable=True)
    page = Column(Integer, nullable=False, index=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)
    # The analyzer found the marker but not what it pointed at, and the
    # number printed in it was read instead. A guess, and marked as one.
    inferred = Column(Boolean, default=False)

    paper = relationship("Paper", back_populates="citations")
    reference = relationship("PaperReference")


class PaperLink(Base):
    """One analyzed cross-reference to another position in the PDF."""
    __tablename__ = "paper_links"

    uuid = uuid_key()
    paper_sha256 = Column(String(64), ForeignKey("papers.sha256"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    label = Column(Text, nullable=True)
    page = Column(Integer, nullable=False, index=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)
    target_page = Column(Integer, nullable=False)
    target_y = Column(Float, nullable=False)

    paper = relationship("Paper", back_populates="links")


class Copy(Base):
    """A user's copy of a paper in their nook: ratings, summary, display."""
    __tablename__ = "copies"
    __table_args__ = (UniqueConstraint("paper_sha256", "user_uuid", name="uq_copy"),)

    uuid = uuid_key()
    paper_sha256 = Column(String(64), ForeignKey("papers.sha256"), nullable=False, index=True)
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    shelf_uuid = Column(String(36), ForeignKey("shelves.uuid"), nullable=True, index=True)
    summary = Column(Text, nullable=True)  # private
    thought = Column(Text, nullable=True)  # public one-sentence take
    # The user is an author of this paper ("this is my paper").
    is_author = Column(Boolean, nullable=False, default=False, server_default="0")
    rating_expertise = Column(Integer, nullable=True)
    rating_reading = Column(Integer, nullable=True)
    rating_liking = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

    paper = relationship("Paper", back_populates="copies")
    user = relationship("User", back_populates="copies")
    tags = relationship(
        "Tag", secondary=copy_tags, viewonly=True,
        primaryjoin=lambda: and_(
            Copy.uuid == copy_tags.c.copy_uuid, copy_tags.c.deleted_at.is_(None),
        ),
        secondaryjoin=lambda: Tag.uuid == copy_tags.c.tag_uuid,
    )
    shelf = relationship("Shelf", back_populates="copies")

    @property
    def is_public(self) -> bool:
        """Whether this copy is on display, which is the shelf's answer and
        only ever the shelf's. Asked each time rather than kept alongside:
        a second copy of one fact is a second thing to keep true, and the
        two drift the moment any path forgets. A copy on no shelf is on no
        display — there is nothing standing behind it."""
        return self.shelf is not None and bool(self.shelf.is_public)


class Shelf(Base):
    """One of a user's five homes for papers. Visibility belongs to the
    shelf, and to nothing else: a copy is public exactly while the shelf it
    sits on is."""
    __tablename__ = "shelves"
    __table_args__ = (UniqueConstraint("user_uuid", "name", name="uq_shelf_user_name"),)

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    name = Column(String(40), nullable=False)
    color = Column(String(7), nullable=False)
    is_public = Column(Boolean, nullable=False, default=False, server_default="0")
    is_default = Column(Boolean, nullable=False, default=False, server_default="0")
    position = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="shelves")
    copies = relationship("Copy", back_populates="shelf")
    boards = relationship("Board", back_populates="shelf")


class Tag(Base):
    """A private label in one user's nook."""
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_uuid", "name", name="uq_tag_user_name"),)

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    name = Column(String(60), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="tags")
    copies = relationship(
        "Copy", secondary=copy_tags, viewonly=True,
        primaryjoin=lambda: and_(
            Tag.uuid == copy_tags.c.tag_uuid, copy_tags.c.deleted_at.is_(None),
        ),
        secondaryjoin=lambda: Copy.uuid == copy_tags.c.copy_uuid,
    )


class CopyTagLink(Base):
    """Synchronized identity for one private copy/tag membership."""
    __table__ = copy_tags
    copy = relationship("Copy", foreign_keys=[copy_tags.c.copy_uuid])
    tag = relationship("Tag", foreign_keys=[copy_tags.c.tag_uuid])


class Annotation(Base):
    """Everything a user leaves on a paper.

    A note is words, optionally pinned to a place. Ink is a stroke drawn over
    the page. A clip is a movable view of one rectangle of it. They differ in
    what they draw, not in what they are: each belongs to one user, sits on
    one paper, and is private to them unless they share a reading.

    `kind` says which — note | ink | clip — and `body` carries the geometry
    that only that kind has. Geometry was always JSON text here; a polyline
    and an anchor were never columns SQLite could do anything with. The
    columns that remain are the ones every kind answers, and the ones a
    person can read: the words, and what the user calls them.

    Coordinates in `body` are fractions of the page in PDF user space, so
    zoom, DPI and screen size never enter them; ink and clip geometry measure
    y from the bottom, as PDF does.
    """
    __tablename__ = "annotations"

    uuid = uuid_key()
    kind = Column(String(8), nullable=False, index=True)
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    paper_sha256 = Column(String(64), ForeignKey("papers.sha256"), nullable=False, index=True)
    # Null only for a note about the paper that was never put on a page.
    page = Column(Integer, nullable=True, index=True)
    # Several stored paths can be one logical annotation: text painted across lines
    # is drawn as separate strokes but picked up and erased as one.
    group_uuid = Column(String(36), nullable=True)
    # Empty while an anchor is only an annotation, before anything is written.
    content = Column(Text, nullable=False, default="")
    # What the user calls this annotation; the page number stands in when
    # they have not named it.
    name = Column(String, nullable=True)
    body = Column(Text, nullable=False, default="{}", server_default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

    paper = relationship("Paper", back_populates="annotations")
    user = relationship("User")


class Board(Base):
    """A private ideation space inside one user's nook."""
    __tablename__ = "boards"

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    shelf_uuid = Column(String(36), ForeignKey("shelves.uuid"), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

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

    uuid = uuid_key()
    board_uuid = Column(String(36), ForeignKey("boards.uuid"), nullable=False, index=True)
    kind = Column(String(20), nullable=False, default="booklet", server_default="booklet")
    title = Column(String(240), nullable=False)
    header = Column(Text, nullable=True)
    auto_arrange = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

    board = relationship("Board", back_populates="groups")
    items = relationship("BoardItem", back_populates="group")


class BoardItem(Base):
    """A card on a board; ``kind`` describes the card's payload."""
    __tablename__ = "board_items"

    uuid = uuid_key()
    board_uuid = Column(String(36), ForeignKey("boards.uuid"), nullable=False, index=True)
    group_uuid = Column(String(36), ForeignKey("board_groups.uuid"), nullable=True, index=True)
    kind = Column(String(20), nullable=False)  # comment | excerpt | image | file | youtube | webpage
    content = Column(Text, nullable=True)
    excerpt_text = Column(Text, nullable=True)
    file_path = Column(Text, nullable=True)
    sha256 = Column(String(64), nullable=True, index=True)
    original_filename = Column(Text, nullable=True)
    mime_type = Column(String(255), nullable=True)
    source_url = Column(Text, nullable=True)
    source_label = Column(Text, nullable=True)
    staged = Column(Boolean, nullable=False, default=False, server_default="0")
    text_align = Column(String(10), nullable=False, default="left", server_default="left")
    position = Column(Integer, nullable=False, default=0, server_default="0")
    x = Column(Float, nullable=False, default=0, server_default="0")
    y = Column(Float, nullable=False, default=0, server_default="0")
    width = Column(Float, nullable=False, default=300, server_default="300")
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=0, server_default="0")

    board = relationship("Board", back_populates="items")
    group = relationship("BoardGroup", back_populates="items")


class Sharable(Base):
    """One user's reading of one paper, handed to anyone with the link.

    The link carries this row's UUID and nothing else, so the UUID is the
    whole of the permission: distinct from the paper's, because what it
    opens is not the paper. A *rich* link opens a reading — the PDF, the
    notes this user wrote on it, the ink they drew and the clips they cut
    — and belongs to them. A *lean* link opens the PDF alone and belongs
    to nobody: one per paper, handed to whoever asks for it, with no user
    named on it and none implied.

    The reading is named, not copied. A note reworded after the link was
    given out is reworded for everyone holding it, which is what a user
    means by sharing what they are reading rather than a snapshot of it.
    Revoking stamps `revoked_at`: the row stays, so a link handed out is
    answered with "no longer shared" instead of a 404 that reads as a typo.
    """
    __tablename__ = "sharables"

    uuid = uuid_key()
    # What the link carries. "rich" is the reading — this user's notes,
    # ink and clips on the PDF. "lean" is the PDF alone, which is a
    # different and smaller thing to hand someone: here is the paper.
    #
    # A rich link depends on a copy in the user's nook. Take the paper out
    # and the reading it named is gone, so the link becomes lean rather than
    # dying: what is left of it is still the paper. The demotion is
    # permanent — putting the paper back must not silently re-expose annotations
    # to everyone still holding the link.
    kind = Column(String(8), nullable=False, default="lean", server_default="lean")
    # Whose reading this is — and nobody's, when the link carries the paper
    # alone. A lean link makes no claim about a user: it says "here is this
    # PDF", which is true of the paper and not of anyone's nook. Leaving it
    # null is what keeps it out of its maker's hands: not on their paper
    # page, not theirs to revoke, and not a thing they are told exists.
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=True, index=True)
    paper_sha256 = Column(String(64), ForeignKey("papers.sha256"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User")
    paper = relationship("Paper")

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None


class Room(Base):
    """A seminar cohort for a paper.

    Keyed by the *work* rather than by the paper: a preprint and the
    published version are two papers, each with its own copies and
    annotations, and there is still only one conversation to be had about
    them. So `paper_key` is the DOI, or the title when there is no DOI —
    read off metadata any user may correct, which is why `cohorts.rekey_rooms`
    exists to carry a seminar over when one of them does.
    """
    __tablename__ = "rooms"

    uuid = uuid_key()
    paper_key = Column(String, nullable=False, index=True)
    paper_title = Column(Text, nullable=False)
    created_by = Column(String(36), ForeignKey("users.uuid"), nullable=False)
    leader_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=True)
    status = Column(String, nullable=False, default="open")  # open | planning | scheduled | finished
    scheduled_time = Column(Text, nullable=True)
    platform = Column(Text, nullable=True)
    style = Column(String, nullable=True)  # preset key or a custom title
    style_desc = Column(Text, nullable=True)  # custom style's description
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User", foreign_keys=[created_by])
    leader = relationship("User", foreign_keys=[leader_uuid])
    participants = relationship(
        "RoomParticipant", back_populates="room", cascade="all, delete-orphan",
        order_by="RoomParticipant.created_at",
    )
    messages = relationship("RoomMessage", back_populates="room", cascade="all, delete-orphan")
    availabilities = relationship(
        "RoomAvailability", back_populates="room", cascade="all, delete-orphan"
    )


class RoomParticipant(Base):
    __tablename__ = "room_participants"
    __table_args__ = (UniqueConstraint("room_uuid", "user_uuid", name="uq_room_participant"),)

    uuid = uuid_key()
    room_uuid = Column(String(36), ForeignKey("rooms.uuid"), nullable=False, index=True)
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room = relationship("Room", back_populates="participants")
    user = relationship("User")


class RoomMessage(Base):
    __tablename__ = "room_messages"

    uuid = uuid_key()
    room_uuid = Column(String(36), ForeignKey("rooms.uuid"), nullable=False, index=True)
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room = relationship("Room", back_populates="messages")
    user = relationship("User")


class RoomAvailability(Base):
    __tablename__ = "room_availabilities"
    __table_args__ = (UniqueConstraint("room_uuid", "user_uuid", name="uq_room_availability"),)

    uuid = uuid_key()
    room_uuid = Column(String(36), ForeignKey("rooms.uuid"), nullable=False, index=True)
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False)
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

    uuid = uuid_key()
    method = Column(String, nullable=True)
    path = Column(Text, nullable=True)
    message = Column(Text, nullable=False)
    traceback = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    room_uuid = Column(String(36), ForeignKey("rooms.uuid"), nullable=True)
    content = Column(Text, nullable=False)
    read = Column(Boolean, nullable=False, default=False)
    emailed = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    room = relationship("Room")


class AdminMessage(Base):
    """A message an administrator broadcasts to every user."""
    __tablename__ = "admin_messages"

    uuid = uuid_key()
    created_by_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    created_by = relationship("User")
    deliveries = relationship(
        "AdminMessageDelivery",
        back_populates="message",
        cascade="all, delete-orphan",
    )


class AdminMessageDelivery(Base):
    """One user's durable receipt and dismissal of an admin message."""
    __tablename__ = "admin_message_deliveries"
    __table_args__ = (
        UniqueConstraint("message_uuid", "user_uuid", name="uq_admin_message_delivery"),
    )

    uuid = uuid_key()
    message_uuid = Column(
        String(36), ForeignKey("admin_messages.uuid"), nullable=False, index=True,
    )
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=False, index=True)
    dismissed_at = Column(DateTime, nullable=True)

    message = relationship("AdminMessage", back_populates="deliveries")
    user = relationship("User")


class Feedback(Base):
    """A bug report or feature request. Kept for the admins to work
    through; the reporter may be signed out, hence the nullable user."""
    __tablename__ = "feedback"

    uuid = uuid_key()
    user_uuid = Column(String(36), ForeignKey("users.uuid"), nullable=True, index=True)
    content = Column(Text, nullable=False)
    # Where the reporter was in the app, and how to reach them when they
    # have no account.
    page = Column(Text, nullable=True)
    contact = Column(String, nullable=True)
    resolved = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
