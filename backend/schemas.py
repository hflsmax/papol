from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from typing import Optional, List, Literal


# ---------- Users / auth ----------

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserRegister(BaseModel):
    email: str = Field(max_length=254, pattern=EMAIL_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    affiliation: Optional[str] = Field(default=None, max_length=120)
    password: str = Field(min_length=6, max_length=200)


class UserLogin(BaseModel):
    email: str
    password: str


class UserBase(BaseModel):
    id: int
    display_name: str
    affiliation: Optional[str] = None
    avatar_path: Optional[str] = None

    class Config:
        from_attributes = True


class UserPublic(UserBase):
    """What other readers see. The email is carried only when the reader
    chose to show it — the validator drops it otherwise, so an endpoint
    cannot leak an address by forgetting to check the flag."""
    email: Optional[str] = None
    # Read from the user row to drive the check, never serialized.
    email_public: bool = Field(default=True, exclude=True)

    @model_validator(mode="after")
    def _drop_hidden_email(self):
        if not self.email_public:
            self.email = None
        return self


class UserPrivate(UserBase):
    """The signed-in reader's own record — always carries their email."""
    email: str
    email_public: bool = True
    is_admin: bool = False


class AdminSQL(BaseModel):
    query: str = Field(min_length=1, max_length=10000)


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=80)
    affiliation: Optional[str] = Field(default=None, max_length=120)
    email_public: Optional[bool] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=200)


class AccountDeletion(BaseModel):
    """Closing an account is irreversible, so it asks the reader to type
    their own address out. Being signed in is what proves who they are;
    this is what proves they meant it."""
    confirm_email: str


class UserDirectoryEntry(UserPublic):
    paper_count: int = 0


class AuthResponse(BaseModel):
    token: str
    user: UserPrivate


# ---------- Comments (private notes) ----------

class PointAnchor(BaseModel):
    """A place on a page, as fractions of its width and height in PDF user
    space. Later anchor kinds (rect, polygon, quote) join this as a union
    discriminated on `type`."""
    type: Literal["point"] = "point"
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


Anchor = PointAnchor


class InkPoint(BaseModel):
    """A point on a stroke: a fraction of the page, y from the bottom."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class InkStrokeCreate(BaseModel):
    page: int = Field(ge=1)
    # Two points is a dash and one is a dot; both are marks a reader meant
    # to make. The ceiling is what stops a stray gesture, or a script, from
    # posting a megabyte of coordinates: a stroke drawn across a page at
    # pointer resolution is a few hundred points.
    points: List[InkPoint] = Field(min_length=1, max_length=4000)
    color: str = Field(default="#b3923d", pattern=r"^#[0-9a-fA-F]{6}$")
    width: float = Field(default=0.004, gt=0, le=0.1)


class InkStrokeOut(BaseModel):
    id: int
    page: int
    points: List[InkPoint]
    color: str
    width: float

    class Config:
        from_attributes = True


class CommentCreate(BaseModel):
    # A bare anchor is allowed: the reader marks a place first and writes
    # about it later. A note with no place must say something.
    content: str = Field(default="", max_length=4000)
    # A located note carries both; a plain note carries neither.
    page: Optional[int] = Field(default=None, ge=1)
    anchor: Optional[Anchor] = None
    # Marks this as the reader's place in the paper, displacing any other.
    current_place: bool = False
    name: Optional[str] = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _location_is_all_or_nothing(self):
        if (self.page is None) != (self.anchor is None):
            raise ValueError("a located note needs both a page and an anchor")
        if self.anchor is None and not self.content.strip():
            raise ValueError("a note with no place needs something written in it")
        return self


class CommentUpdate(BaseModel):
    """Rewording a note, or moving its anchor — each independently, so a
    move never disturbs the words and vice versa. Only what is sent
    changes; an anchor may be emptied back to a bare mark."""
    content: Optional[str] = Field(default=None, max_length=4000)
    page: Optional[int] = Field(default=None, ge=1)
    anchor: Optional[Anchor] = None
    current_place: Optional[bool] = None
    name: Optional[str] = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _moving_needs_both(self):
        if (self.page is None) != (self.anchor is None):
            raise ValueError("moving a note needs both a page and an anchor")
        return self


class Comment(BaseModel):
    id: int
    paper_id: int
    content: str
    created_at: datetime
    user: Optional[UserPublic] = None
    # Where in the PDF this note is fixed, when it is.
    page: Optional[int] = None
    anchor_type: Optional[str] = None
    anchor: Optional[Anchor] = None
    edition_id: Optional[int] = None
    current_place: bool = False
    name: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Rooms ----------

class RoomSummary(BaseModel):
    id: int
    status: str  # open | planning | scheduled | finished
    scheduled_time: Optional[str] = None
    platform: Optional[str] = None
    style: Optional[str] = None
    style_desc: Optional[str] = None
    created_at: datetime
    creator: UserPublic
    leader: Optional[UserPublic] = None
    participant_count: int = 0
    participants: List[UserPublic] = []


class RoomMessageOut(BaseModel):
    id: int
    content: str
    created_at: datetime
    user: UserPublic

    class Config:
        from_attributes = True


class RoomAvailabilityOut(BaseModel):
    id: int
    availability: str
    created_at: datetime
    user: UserPublic

    class Config:
        from_attributes = True


class RoomDetail(RoomSummary):
    paper_title: str
    paper_id: Optional[int] = None
    messages: List[RoomMessageOut] = []
    availabilities: List[RoomAvailabilityOut] = []
    viewer_can_lead: bool = False
    viewer_is_participant: bool = False
    viewer_is_reader: bool = False
    viewer_hidden_entry_id: Optional[int] = None  # paper id, if viewer's copy is hidden


class RoomMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class AvailabilitySubmit(BaseModel):
    availability: str = Field(min_length=1, max_length=500)


class RoomAnnounce(BaseModel):
    scheduled_time: str = Field(min_length=1, max_length=200)
    platform: str = Field(min_length=1, max_length=200)
    # A preset key from the frontend's style list, or a custom title —
    # in which case style_desc carries the leader's own description.
    style: str = Field(min_length=1, max_length=40)
    style_desc: Optional[str] = Field(default=None, max_length=300)


class RoomLeave(BaseModel):
    # Required when the departing member is the leader of an active seminar:
    # a cohort member they appoint to lead in their place.
    successor_id: Optional[int] = None


class NotificationOut(BaseModel):
    id: int
    content: str
    room_id: Optional[int] = None
    read: bool
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationList(BaseModel):
    unread_count: int
    notifications: List[NotificationOut]


# ---------- Feedback ----------

class FeedbackCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    # The app location the report came from, for reproducing it.
    page: Optional[str] = Field(default=None, max_length=300)
    # How to reach a reporter who has no account.
    contact: Optional[str] = Field(default=None, max_length=254)


class FeedbackOut(BaseModel):
    id: int
    content: str
    page: Optional[str] = None
    contact: Optional[str] = None
    resolved: bool
    created_at: datetime
    user: Optional[UserBase] = None
    # Admin-facing: how to reply to a reporter who has an account.
    user_email: Optional[str] = None

    class Config:
        from_attributes = True


class FeedbackUpdate(BaseModel):
    resolved: bool


# ---------- Papers ----------

class PaperBase(BaseModel):
    """Shared, DOI-keyed metadata."""
    doi: Optional[str] = None
    title: str
    authors: Optional[str] = None  # JSON array as string
    journal: Optional[str] = None
    year: Optional[int] = None


class PaperCreate(PaperBase):
    file_path: str
    summary: Optional[str] = None
    thought: Optional[str] = Field(default=None, max_length=200)
    marketed: bool = True
    is_author: bool = False
    rating_expertise: Optional[int] = Field(default=None, ge=1, le=5)
    rating_reading: Optional[int] = Field(default=None, ge=1, le=5)
    rating_liking: Optional[int] = Field(default=None, ge=1, le=5)
    initial_comment: Optional[str] = None


class EditionAdopt(BaseModel):
    # Which edition to move the viewer's copy to; the latest by default.
    edition_id: Optional[int] = None


class PaperUpdate(BaseModel):
    # Shared metadata (any reader; applies to the one canonical paper)
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[str] = None
    journal: Optional[str] = None
    year: Optional[int] = None
    # Personal fields (the viewer's own copy)
    summary: Optional[str] = None
    thought: Optional[str] = Field(default=None, max_length=200)
    marketed: Optional[bool] = None
    is_author: Optional[bool] = None
    rating_expertise: Optional[int] = Field(default=None, ge=1, le=5)
    rating_reading: Optional[int] = Field(default=None, ge=1, le=5)
    rating_liking: Optional[int] = Field(default=None, ge=1, le=5)


class ReaderEntry(BaseModel):
    """A reader's displayed copy of a paper."""
    paper_id: int
    user: UserPublic
    is_author: bool = False  # this reader wrote the paper
    thought: Optional[str] = None  # the reader's public one-sentence take
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None


# ---------- References ----------

class ResolvedWork(BaseModel):
    """What a reference turned out to be, once looked up. Every field is
    optional: a match may be thin, and a thin match still beats none."""
    title: Optional[str] = None
    authors: List[str] = []
    year: Optional[int] = None
    venue: Optional[str] = None
    abstract: Optional[str] = None
    citations: Optional[int] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    source: Optional[str] = None


class ReferenceOut(BaseModel):
    """One work cited by the paper being read."""
    id: int
    key: str
    index: int
    # As printed. Always shown when the lookup found nothing, so a reader
    # is never left with an empty card.
    raw: Optional[str] = None
    title: Optional[str] = None
    year: Optional[int] = None
    # Where the entry sits in the bibliography, as fractions of the page:
    # the viewer uses it to match the PDF's own citation links, which point
    # at a place rather than at an entry.
    page: Optional[int] = None
    y: Optional[float] = None
    # none | ok | miss | error — filled in the first time it is opened.
    resolved_status: Optional[str] = None
    resolution: Optional[ResolvedWork] = None
    # A paper already in Papol that this reference names, when there is
    # one: the reader can go straight to it instead of out to a publisher.
    papol_paper_id: Optional[int] = None


class CitationOut(BaseModel):
    """One clickable marker in the text, as fractions of its page measured
    from the top-left corner."""
    reference_id: int
    label: Optional[str] = None
    page: int
    x: float
    y: float
    w: float
    h: float
    inferred: bool = False


class EditionReferences(BaseModel):
    """The state of one edition's reference analysis.

    `status` is what the viewer acts on: `pending` means come back shortly,
    `unavailable` means this Papol has no analyzer and the feature is
    simply off."""
    edition_id: int
    status: str  # pending | ready | failed | unavailable
    detail: Optional[str] = None
    references: List[ReferenceOut] = []
    citations: List[CitationOut] = []


class PaperEditionOut(BaseModel):
    id: int
    file_path: str
    created_at: datetime
    uploader: Optional[UserBase] = None

    class Config:
        from_attributes = True


class PaperList(PaperBase):
    id: int
    # The file the viewer's own copy reads, falling back to the latest
    # edition for a paper they do not have.
    file_path: str
    created_at: datetime
    # Personal fields of the nook being viewed (None in the global list)
    summary: Optional[str] = None
    thought: Optional[str] = None
    marketed: Optional[bool] = None
    is_author: Optional[bool] = None
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None
    room_status: Optional[str] = None
    readers: List[ReaderEntry] = []
    edition_id: Optional[int] = None

    class Config:
        from_attributes = True


class Paper(PaperBase):
    """Paper detail, merged with the viewer's own copy when they have one."""
    id: int
    file_path: str
    created_at: datetime
    summary: Optional[str] = None
    thought: Optional[str] = None
    marketed: Optional[bool] = None
    is_author: Optional[bool] = None
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None
    comments: List[Comment] = []  # the viewer's own notes
    also_read_by: List[ReaderEntry] = []  # every displayed copy
    rooms: List[RoomSummary] = []  # this paper's seminar rooms, newest first
    viewer_is_reader: bool = False  # viewer has a displayed copy
    viewer_has_entry: bool = False  # viewer has any copy
    # Editions: which one the viewer reads, and whether a newer one waits.
    edition_id: Optional[int] = None
    ignored_edition_id: Optional[int] = None
    editions: List[PaperEditionOut] = []
    latest_edition: Optional[PaperEditionOut] = None

    class Config:
        from_attributes = True


class NookStats(BaseModel):
    """The owner's reading-journey numbers, shown on their own nook."""
    papers: int = 0
    displayed: int = 0
    notes: int = 0
    seminars: int = 0


class UserSpace(BaseModel):
    user: UserPublic
    papers: List[PaperList]
    stats: Optional[NookStats] = None  # own nook only


class ExtractedMetadata(BaseModel):
    doi: Optional[str] = None
    title: str
    authors: Optional[str] = None
    journal: Optional[str] = None
    year: Optional[int] = None
    file_path: str
