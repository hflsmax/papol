from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


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


class UserPublic(BaseModel):
    """What other readers see — the email stays private."""
    id: int
    display_name: str
    affiliation: Optional[str] = None
    avatar_path: Optional[str] = None

    class Config:
        from_attributes = True


class UserPrivate(UserPublic):
    email: str
    is_admin: bool = False


class AdminSQL(BaseModel):
    query: str = Field(min_length=1, max_length=10000)


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=80)
    affiliation: Optional[str] = Field(default=None, max_length=120)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=200)


class UserDirectoryEntry(UserPublic):
    paper_count: int = 0


class AuthResponse(BaseModel):
    token: str
    user: UserPrivate


# ---------- Comments (private notes) ----------

class CommentCreate(BaseModel):
    content: str


class Comment(BaseModel):
    id: int
    paper_id: int
    content: str
    created_at: datetime
    user: Optional[UserPublic] = None

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
    marketed: bool = True
    rating_expertise: Optional[int] = Field(default=None, ge=1, le=5)
    rating_reading: Optional[int] = Field(default=None, ge=1, le=5)
    rating_liking: Optional[int] = Field(default=None, ge=1, le=5)
    initial_comment: Optional[str] = None


class PaperUpdate(BaseModel):
    # Shared metadata (any reader; applies to the one canonical paper)
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[str] = None
    journal: Optional[str] = None
    year: Optional[int] = None
    # Personal fields (the viewer's own copy)
    summary: Optional[str] = None
    marketed: Optional[bool] = None
    rating_expertise: Optional[int] = Field(default=None, ge=1, le=5)
    rating_reading: Optional[int] = Field(default=None, ge=1, le=5)
    rating_liking: Optional[int] = Field(default=None, ge=1, le=5)


class ReaderEntry(BaseModel):
    """A reader's displayed copy of a paper."""
    paper_id: int
    user: UserPublic
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None


class PaperList(PaperBase):
    id: int
    file_path: str
    created_at: datetime
    # Personal fields of the nook being viewed (None in the global list)
    summary: Optional[str] = None
    marketed: Optional[bool] = None
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None
    room_status: Optional[str] = None
    readers: List[ReaderEntry] = []

    class Config:
        from_attributes = True


class Paper(PaperBase):
    """Paper detail, merged with the viewer's own copy when they have one."""
    id: int
    file_path: str
    created_at: datetime
    summary: Optional[str] = None
    marketed: Optional[bool] = None
    rating_expertise: Optional[int] = None
    rating_reading: Optional[int] = None
    rating_liking: Optional[int] = None
    comments: List[Comment] = []  # the viewer's own notes
    also_read_by: List[ReaderEntry] = []  # every displayed copy
    rooms: List[RoomSummary] = []  # this paper's seminar rooms, newest first
    viewer_is_reader: bool = False  # viewer has a displayed copy
    viewer_has_entry: bool = False  # viewer has any copy

    class Config:
        from_attributes = True


class UserSpace(BaseModel):
    user: UserPublic
    papers: List[PaperList]


class ExtractedMetadata(BaseModel):
    doi: Optional[str] = None
    title: str
    authors: Optional[str] = None
    journal: Optional[str] = None
    year: Optional[int] = None
    file_path: str
