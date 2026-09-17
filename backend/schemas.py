from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from typing import Optional, List, Literal
from app_limits import limit


# ---------- Users / auth ----------

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserRegister(BaseModel):
    email: str = Field(max_length=limit("text", "email"), pattern=EMAIL_PATTERN)
    display_name: str = Field(min_length=1, max_length=limit("text", "display_name"))
    affiliation: Optional[str] = Field(default=None, max_length=limit("text", "affiliation"))
    password: str = Field(min_length=6, max_length=limit("text", "password"))


class UserLogin(BaseModel):
    email: str
    password: str


class UserBase(BaseModel):
    uuid: str
    display_name: str
    affiliation: Optional[str] = None
    avatar_path: Optional[str] = None

    class Config:
        from_attributes = True


class UserPublic(UserBase):
    """What other users see. The email is carried only when the user
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
    """The signed-in user's own record — always carries their email."""
    email: str
    email_public: bool = True
    is_admin: bool = False


class AdminSQL(BaseModel):
    query: str = Field(min_length=1, max_length=limit("text", "admin_query"))


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=limit("text", "display_name"))
    affiliation: Optional[str] = Field(default=None, max_length=limit("text", "affiliation"))
    email_public: Optional[bool] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=limit("text", "password"))


class AccountDeletion(BaseModel):
    """Closing an account is irreversible, so it asks the user to type
    their own address out. Being signed in is what proves who they are;
    this is what proves they meant it."""
    confirm_email: str


class UserListEntry(UserPublic):
    paper_count: int = 0


class AuthResponse(BaseModel):
    token: str
    user: UserPrivate


# ---------- Annotations (a user's annotations on a paper) ----------

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


class ClipRect(BaseModel):
    """The source rectangle, which must be wholly inside one PDF page."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def stays_on_page(self):
        if self.x + self.w > 1.000001 or self.y + self.h > 1.000001:
            raise ValueError("rectangle must stay on its page")
        return self


class ClipFrame(BaseModel):
    """Displayed placement relative to a page or viewport.

    Page-relative frames may extend beyond either edge so a clip can sit in
    a gutter or span neighboring pages. The generous finite bounds reject
    corrupt coordinates without imposing a visual boundary.
    """
    x: float = Field(ge=-limit("annotations", "clip_frame_coordinate_abs_max"), le=limit("annotations", "clip_frame_coordinate_abs_max"))
    y: float = Field(ge=-limit("annotations", "clip_frame_coordinate_abs_max"), le=limit("annotations", "clip_frame_coordinate_abs_max"))
    w: float = Field(gt=0, le=limit("annotations", "clip_frame_size_max"))
    h: float = Field(gt=0, le=limit("annotations", "clip_frame_size_max"))


# The three bodies: what each kind of annotation has that the others do not.

class NoteBody(BaseModel):
    """Where a note is fixed, when it is fixed anywhere at all."""
    anchor: Optional[Anchor] = None


class InkBody(BaseModel):
    # Two points is a dash and one is a dot; both are annotations a user meant
    # to make. The ceiling is what stops a stray gesture, or a script, from
    # posting a megabyte of coordinates: a stroke drawn across a page at
    # pointer resolution is a few hundred points.
    points: List[InkPoint] = Field(min_length=1, max_length=limit("counts", "ink_points"))
    color: str = Field(default="#b3923d", pattern=r"^#[0-9a-fA-F]{6}$")
    width: float = Field(default=0.004, gt=0, le=limit("annotations", "ink_width_max"))
    # 1 is solid ink; less lets the words underneath show through, which is
    # what a user wants when marking a line rather than crossing it out.
    opacity: float = Field(default=1.0, gt=0, le=1)
    # The nib: "flat" is a chisel held upright, wide across the page and thin
    # along it; "round" is the same weight whichever way it is drawn.
    shape: Literal["flat", "round"] = "flat"


class ClipBody(BaseModel):
    source: ClipRect
    frame: ClipFrame
    floating: bool = False


AnnotationBody = NoteBody | InkBody | ClipBody


class AnnotationCreate(BaseModel):
    """A new annotation. `kind` decides which body is required, and which of
    the shared fields mean anything: ink and clips are always on a page of a
    PDF, while a note may be about the paper and placed nowhere."""
    kind: Literal["note", "ink", "clip"]
    page: Optional[int] = Field(default=None, ge=1)
    group_uuid: Optional[str] = Field(default=None, max_length=36)
    content: str = Field(default="", max_length=limit("text", "comment"))
    name: Optional[str] = Field(default=None, max_length=limit("text", "annotation_name"))
    body: AnnotationBody = NoteBody()

    @model_validator(mode="after")
    def _kind_and_body_agree(self):
        wanted = {"note": NoteBody, "ink": InkBody, "clip": ClipBody}[self.kind]
        if not isinstance(self.body, wanted):
            raise ValueError(f"a {self.kind} needs a {self.kind} body")
        if self.kind == "note":
            # A bare anchor is allowed: the user annotations a place first and
            # writes about it later. A note with no place must say something.
            if (self.page is None) != (self.body.anchor is None):
                raise ValueError("a located note needs both a page and an anchor")
            if self.body.anchor is None and not self.content.strip():
                raise ValueError("a note with no place needs something written in it")
        elif self.page is None:
            raise ValueError(f"a {self.kind} belongs on a page")
        return self


class AnnotationUpdate(BaseModel):
    """What may change after an annotation is made. Only what is sent
    changes, so rewording a note never disturbs where it sits, and moving it
    never disturbs the words.

    `body` is merged into the stored geometry rather than replacing it —
    carrying a stroke somewhere else says where its points are now, not what
    colour it was drawn in — and the result is held to its kind's shape."""
    page: Optional[int] = Field(default=None, ge=1)
    content: Optional[str] = Field(default=None, max_length=limit("text", "comment"))
    name: Optional[str] = Field(default=None, max_length=limit("text", "annotation_name"))
    body: Optional[dict] = None


class AnnotationOut(BaseModel):
    uuid: str
    kind: Literal["note", "ink", "clip"]
    page: Optional[int] = None
    group_uuid: Optional[str] = None
    content: str = ""
    name: Optional[str] = None
    body: AnnotationBody
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Boards (private nook ideation spaces) ----------

class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=limit("text", "board_name"))
    description: Optional[str] = Field(default=None, max_length=limit("text", "board_description"))
    shelf_uuid: Optional[str] = None


class BoardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=limit("text", "board_name"))
    description: Optional[str] = Field(default=None, max_length=limit("text", "board_description"))
    shelf_uuid: Optional[str] = None


class BoardItemCreate(BaseModel):
    content: str = Field(min_length=1, max_length=limit("text", "board_content"))
    x: Optional[float] = Field(default=None, ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    y: Optional[float] = Field(default=None, ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))


class BoardStagingCreate(BaseModel):
    excerpt_text: str = Field(min_length=1, max_length=limit("text", "board_content"))
    content: Optional[str] = Field(default=None, max_length=limit("text", "board_content"))
    source_url: str = Field(min_length=1, max_length=limit("text", "source_url"), pattern=r"^https?://")
    source_label: str = Field(min_length=1, max_length=limit("text", "source_label"))


class BoardStagingPlace(BaseModel):
    x: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    y: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))


class BoardItemUpdate(BaseModel):
    group_uuid: Optional[str] = None
    x: Optional[float] = Field(default=None, ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    y: Optional[float] = Field(default=None, ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    width: Optional[float] = Field(default=None, ge=limit("board", "item_width_min"), le=limit("board", "item_width_max"))
    position: Optional[int] = Field(default=None, ge=0, le=limit("board", "position_max"))
    content: Optional[str] = Field(default=None, max_length=limit("text", "board_content"))
    text_align: Optional[Literal["left", "center", "right"]] = None


class BoardGroupCreate(BaseModel):
    kind: Literal["booklet", "collection"] = "booklet"
    title: str = Field(default="", max_length=limit("text", "board_group_title"))
    header: str = Field(default="", max_length=limit("text", "board_group_header"))
    auto_arrange: bool = False
    item_uuids: List[str] = Field(min_length=2, max_length=limit("counts", "board_group_items"))


class BoardGroupUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=limit("text", "board_group_title"))
    header: Optional[str] = Field(default=None, max_length=limit("text", "board_group_header"))
    auto_arrange: Optional[bool] = None


class BoardGroupMove(BaseModel):
    dx: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    dy: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))


class BoardGroupRestoreItem(BaseModel):
    uuid: str
    group_uuid: Optional[str] = None
    x: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    y: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))


class BoardGroupUngroup(BaseModel):
    items: List[BoardGroupRestoreItem] = Field(min_length=2, max_length=limit("counts", "board_group_items"))


class BoardGroupLayout(BaseModel):
    items: List[BoardGroupRestoreItem] = Field(min_length=1, max_length=limit("counts", "board_group_items"))


class BoardGroupOut(BaseModel):
    uuid: str
    kind: Literal["booklet", "collection"]
    title: str
    header: str = ""
    auto_arrange: bool = False
    item_uuids: List[str] = []

    class Config:
        from_attributes = True


class BoardYouTubeCreate(BaseModel):
    url: str = Field(min_length=1, max_length=limit("text", "external_url"))
    x: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))
    y: float = Field(ge=-limit("board", "coordinate_abs_max"), le=limit("board", "coordinate_abs_max"))


class BoardWebpageCreate(BoardYouTubeCreate):
    pass


class BoardItemOut(BaseModel):
    uuid: str
    group_uuid: Optional[str] = None
    kind: Literal["comment", "excerpt", "image", "file", "youtube", "webpage"]
    content: Optional[str] = None
    excerpt_text: Optional[str] = None
    file_path: Optional[str] = None
    sha256: Optional[str] = None
    original_filename: Optional[str] = None
    mime_type: Optional[str] = None
    source_url: Optional[str] = None
    source_label: Optional[str] = None
    staged: bool = False
    text_align: Literal["left", "center", "right"] = "left"
    position: int
    x: float
    y: float
    width: float
    deleted_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BoardOut(BaseModel):
    uuid: str
    revision: int
    user_uuid: str
    owner: Optional[UserPublic] = None
    shelf_uuid: Optional[str] = None
    can_edit: bool = False
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    item_count: int = 0
    items: List[BoardItemOut] = []
    staged_items: List[BoardItemOut] = []
    groups: List[BoardGroupOut] = []

    class Config:
        from_attributes = True


# ---------- Rooms ----------

class RoomSummary(BaseModel):
    uuid: str
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
    uuid: str
    content: str
    created_at: datetime
    user: UserPublic

    class Config:
        from_attributes = True


class RoomAvailabilityOut(BaseModel):
    uuid: str
    availability: str
    created_at: datetime
    user: UserPublic

    class Config:
        from_attributes = True


class RoomDetail(RoomSummary):
    paper_title: str
    paper_sha256: Optional[str] = None
    messages: List[RoomMessageOut] = []
    availabilities: List[RoomAvailabilityOut] = []
    viewer_can_lead: bool = False
    viewer_is_participant: bool = False
    viewer_has_copy: bool = False
    # The paper's digest, when the viewer keeps it but does not display it.
    viewer_hidden_entry_sha256: Optional[str] = None


class RoomMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=limit("text", "room_message"))


class AvailabilitySubmit(BaseModel):
    availability: str = Field(min_length=1, max_length=limit("text", "availability"))


class RoomAnnounce(BaseModel):
    scheduled_time: str = Field(min_length=1, max_length=limit("text", "scheduled_time"))
    platform: str = Field(min_length=1, max_length=limit("text", "platform"))
    # A preset key from the frontend's style list, or a custom title —
    # in which case style_desc carries the leader's own description.
    style: str = Field(min_length=1, max_length=limit("text", "room_style"))
    style_desc: Optional[str] = Field(default=None, max_length=limit("text", "room_style_description"))


class RoomLeave(BaseModel):
    # Required when the departing member is the leader of an active seminar:
    # a cohort member they appoint to lead in their place.
    successor_uuid: Optional[str] = None


class NotificationOut(BaseModel):
    uuid: str
    content: str
    room_uuid: Optional[str] = None
    read: bool
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationList(BaseModel):
    unread_count: int
    notifications: List[NotificationOut]


class AdminMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=limit("text", "admin_message"))
    # None broadcasts to every current account; a non-empty list targets an
    # explicit audience selected by the administrator.
    user_uuids: Optional[List[str]] = Field(default=None, min_length=1)


class AdminMessageRecipient(UserBase):
    email: str


class AdminMessageOut(BaseModel):
    uuid: str
    content: str
    created_at: datetime


class AdminMessageSendResult(AdminMessageOut):
    recipient_count: int


# ---------- Feedback ----------

class FeedbackCreate(BaseModel):
    content: str = Field(min_length=1, max_length=limit("text", "feedback"))
    # The app location the report came from, for reproducing it.
    page: Optional[str] = Field(default=None, max_length=limit("text", "feedback_page"))
    # How to reach a reporter who has no account.
    contact: Optional[str] = Field(default=None, max_length=limit("text", "email"))


class FeedbackOut(BaseModel):
    uuid: str
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
    thought: Optional[str] = Field(default=None, max_length=limit("text", "paper_thought"))
    is_public: bool = True
    is_author: bool = False
    rating_expertise: Optional[int] = Field(default=None, ge=limit("ratings", "min"), le=limit("ratings", "max"))
    rating_reading: Optional[int] = Field(default=None, ge=limit("ratings", "min"), le=limit("ratings", "max"))
    rating_liking: Optional[int] = Field(default=None, ge=limit("ratings", "min"), le=limit("ratings", "max"))
    initial_comment: Optional[str] = None
    tag_uuids: List[str] = []
    shelf_uuid: Optional[str] = None


class PaperMetadata(BaseModel):
    """What a paper's own record may say.

    One shape whoever is writing it. The edit form on the website and a
    replica's push both arrive here, so a title the website accepts is one
    the Mac can push back — before this, the website took a title of any
    length and the push path refused anything over 500 characters, which
    read as an edit that saved and then would not synchronize.

    A paper's title is the one thing it must have: a paper with no title is
    a row nobody can find again."""
    doi: Optional[str] = Field(default=None, max_length=limit("text", "paper_doi"))
    title: str = Field(min_length=1, max_length=limit("text", "paper_title"))
    authors: Optional[str] = Field(default=None, max_length=limit("text", "paper_authors"))
    journal: Optional[str] = Field(default=None, max_length=limit("text", "paper_journal"))
    year: Optional[int] = Field(
        default=None,
        ge=limit("publication_year", "min"),
        le=limit("publication_year", "max"),
    )

    @classmethod
    def of(cls, paper) -> "PaperMetadata":
        """The metadata a stored paper is carrying, for checking it."""
        return cls(
            doi=paper.doi, title=paper.title, authors=paper.authors,
            journal=paper.journal, year=paper.year,
        )


class PaperUpdate(BaseModel):
    # Shared metadata (any user; applies to the one canonical paper). Held
    # to the same limits as PaperMetadata, which is what the paper ends up
    # being checked against whichever way the edit arrived.
    doi: Optional[str] = Field(default=None, max_length=limit("text", "paper_doi"))
    title: Optional[str] = Field(
        default=None, min_length=1, max_length=limit("text", "paper_title"),
    )
    authors: Optional[str] = Field(default=None, max_length=limit("text", "paper_authors"))
    journal: Optional[str] = Field(default=None, max_length=limit("text", "paper_journal"))
    year: Optional[int] = Field(
        default=None,
        ge=limit("publication_year", "min"),
        le=limit("publication_year", "max"),
    )
    # Personal fields (the viewer's own copy)
    summary: Optional[str] = None
    thought: Optional[str] = Field(default=None, max_length=limit("text", "paper_thought"))
    is_public: Optional[bool] = None
    is_author: Optional[bool] = None
    rating_expertise: Optional[int] = Field(default=None, ge=limit("ratings", "min"), le=limit("ratings", "max"))
    rating_reading: Optional[int] = Field(default=None, ge=limit("ratings", "min"), le=limit("ratings", "max"))
    rating_liking: Optional[int] = Field(default=None, ge=limit("ratings", "min"), le=limit("ratings", "max"))
    tag_uuids: Optional[List[str]] = None
    shelf_uuid: Optional[str] = None


class TagOut(BaseModel):
    uuid: str
    name: str

    class Config:
        from_attributes = True


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=limit("text", "tag_name"))


class ShelfOut(BaseModel):
    uuid: str
    name: str
    color: str
    is_public: bool
    is_default: bool
    position: int
    paper_count: int = 0
    board_count: int = 0


class ShelfCreate(BaseModel):
    name: str = Field(min_length=1, max_length=limit("text", "shelf_name"))
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    is_public: bool = False


class ShelfUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=limit("text", "shelf_name"))
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    is_public: Optional[bool] = None
    is_default: Optional[bool] = None


class UserEntry(BaseModel):
    """A user's displayed copy of a paper."""
    paper_sha256: str
    user: UserPublic
    is_author: bool = False  # this user wrote the paper
    thought: Optional[str] = None  # the user's public one-sentence take
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
    uuid: str
    key: str
    index: int
    # As printed. Always shown when the lookup found nothing, so a user
    # is never left with an empty card.
    raw: Optional[str] = None
    title: Optional[str] = None
    year: Optional[int] = None
    # Where the entry sits in the bibliography, as fractions of the page:
    # the viewer uses it to match the PDF's own citation links, which point
    # at a place rather than at an entry.
    page: Optional[int] = None
    y: Optional[float] = None
    # none | ok | bibliography | error — filled in when it is opened.
    resolved_status: Optional[str] = None
    resolution: Optional[ResolvedWork] = None
    # A paper already in Papol that this reference names, when there is
    # one: the user can go straight to it instead of out to a publisher.
    papol_paper_sha256: Optional[str] = None


class ReferencePreviewIn(BaseModel):
    """A PDF-native citation recovered without the document analyzer."""
    key: str = Field(min_length=1, max_length=limit("text", "reference_key"))
    raw: str = Field(min_length=3, max_length=limit("text", "reference_raw"))


class CitationOut(BaseModel):
    """One clickable marker in the text, as fractions of its page measured
    from the top-left corner."""
    reference_uuid: str
    label: Optional[str] = None
    page: int
    x: float
    y: float
    w: float
    h: float
    inferred: bool = False


class DocumentLinkOut(BaseModel):
    """One clickable cross-reference to a position in the same PDF."""
    kind: str
    label: Optional[str] = None
    page: int
    x: float
    y: float
    w: float
    h: float
    target_page: int
    target_y: float


class PaperReferences(BaseModel):
    """The state of one paper's reference analysis.

    `status` is what the viewer acts on: `pending` means come back shortly,
    `unavailable` means this Papol has no analyzer and the feature is
    simply off."""
    paper_sha256: str
    status: str  # pending | ready | failed | unavailable
    detail: Optional[str] = None
    references: List[ReferenceOut] = []
    citations: List[CitationOut] = []
    links: List[DocumentLinkOut] = []


class PaperList(PaperBase):
    uuid: str
    file_path: str
    # The content hash of that file, which is what names it in a viewer URL.
    sha256: Optional[str] = None
    created_at: datetime
    # Personal fields of the nook being viewed (None in the global list)
    summary: Optional[str] = None
    thought: Optional[str] = None
    is_public: Optional[bool] = None
    is_author: Optional[bool] = None
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None
    room_status: Optional[str] = None
    users: List[UserEntry] = []
    tags: List[TagOut] = []
    shelf_uuid: Optional[str] = None
    copy_uuid: Optional[str] = None

    class Config:
        from_attributes = True


class Paper(PaperBase):
    """Paper detail, merged with the viewer's own copy when they have one."""
    uuid: str
    file_path: str
    # The content hash of that file, which is what names it in a viewer URL.
    sha256: Optional[str] = None
    uploader: Optional[UserBase] = None
    created_at: datetime
    summary: Optional[str] = None
    thought: Optional[str] = None
    is_public: Optional[bool] = None
    is_author: Optional[bool] = None
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None
    notes: List[AnnotationOut] = []  # the viewer's own notes on this paper
    also_read_by: List[UserEntry] = []  # every displayed copy
    rooms: List[RoomSummary] = []  # this paper's seminar rooms, newest first
    viewer_has_copy: bool = False  # viewer has a displayed copy
    viewer_has_entry: bool = False  # viewer has any copy
    tags: List[TagOut] = []
    shelf_uuid: Optional[str] = None
    copy_uuid: Optional[str] = None
    # The user's own live link to this paper, when they have handed one
    # out: always one carrying their annotations, since a link to the paper alone
    # belongs to nobody and is never reported to anyone. Not populated for
    # anybody else's copy.
    sharable_uuid: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Sharables ----------

class SharableCreate(BaseModel):
    """Whether the user's annotations travel with the link they are making.

    The default is the quieter link. Handing someone your private notes is
    a thing to choose, not a thing to discover you have done."""
    include_annotations: bool = False


class SharableOut(BaseModel):
    """A link as its asker receives it: what it carries, and since when.

    A rich link is theirs and goes on being reported to them. A lean one is
    answered once, to be copied and handed on, and never mentioned again."""
    uuid: str
    kind: Literal["rich", "lean"]
    paper_sha256: str
    created_at: datetime

    class Config:
        from_attributes = True


class SharedPaper(PaperBase):
    """The paper behind a shared reading.

    No `uuid`, and so no way to the paper's own page. A link hands over one
    reading of one PDF; the page behind it belongs to the Library, which is
    for people with accounts (US-1.4) and is not what was shared. The way out
    of a shared reading is the home button, which goes to Papol itself and
    names no paper."""
    file_path: str
    sha256: Optional[str] = None


class SharedReading(BaseModel):
    """What a link opens: a user's reading of one paper, or — when the
    link is lean, or the reading has left their nook — the paper alone.

    `user` comes with a reading and only with one. The paper alone is
    nobody's to be credited with, and naming whoever asked for the link
    would tell its holder something the link does not mean."""
    uuid: str
    kind: Literal["rich", "lean"]
    user: Optional[UserPublic] = None
    paper: SharedPaper
    # One list, in the order they were made, because that is the order ink
    # has to be painted in. Each says its own kind.
    annotations: List[AnnotationOut] = []
    created_at: datetime


class SharedInNook(BaseModel):
    """Where a shared paper sits in the visitor's own nook, once it does.

    Enough to walk them over to their own copy and no more: the link opened
    a PDF, and what they want next is that PDF as theirs."""
    paper_sha256: str
    sha256: Optional[str] = None


class NookStats(BaseModel):
    """The owner's reading-journey numbers, shown on their own nook."""
    papers: int = 0
    displayed: int = 0
    notes: int = 0
    seminars: int = 0


class UserSpace(BaseModel):
    user: UserPublic
    papers: List[PaperList]
    boards: List[BoardOut] = []
    stats: Optional[NookStats] = None  # own nook only
    tags: List[TagOut] = []  # private: populated only for the owner
    shelves: List[ShelfOut] = []


class ExtractedMetadata(BaseModel):
    doi: Optional[str] = None
    title: str
    authors: Optional[str] = None
    journal: Optional[str] = None
    year: Optional[int] = None
    file_path: str


class ReextractedMetadata(BaseModel):
    """Metadata an external bibliography API found for a stored PDF."""
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[str] = None
    journal: Optional[str] = None
    year: Optional[int] = None
