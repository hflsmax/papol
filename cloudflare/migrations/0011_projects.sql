-- A project: where work on a question happens, by one person or several.
-- It holds papers, not copies: adding a paper to a project leaves every
-- member's copy where it is, and a paper can be in several projects and
-- on its members' shelves at once. Joining is by invitation, the code in
-- the link being the whole of the permission, as with a sharable.
--
-- Nothing here is synchronized: a project is read online, as the Library is.

CREATE TABLE projects (
	uuid VARCHAR(36) NOT NULL,
	name VARCHAR(80) NOT NULL,
	invite_code VARCHAR(10),
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (uuid)
);
CREATE UNIQUE INDEX ix_projects_invite_code ON projects (invite_code);

-- Who is in a project, and who keeps it. `seen_at` is when the member
-- last opened it: what others added after that is new to them.
CREATE TABLE project_members (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	is_keeper BOOLEAN DEFAULT '0' NOT NULL,
	joined_at DATETIME NOT NULL,
	seen_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_member UNIQUE (project_uuid, user_uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_project_members_project_uuid ON project_members (project_uuid);
CREATE INDEX ix_project_members_user_uuid ON project_members (user_uuid);

-- A paper in a project, and who added it. The paper is nobody's, so it
-- stays when the member who added it leaves.
CREATE TABLE project_papers (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	added_by VARCHAR(36) NOT NULL,
	added_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_paper UNIQUE (project_uuid, paper_sha256),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
	FOREIGN KEY(added_by) REFERENCES users (uuid)
);
CREATE INDEX ix_project_papers_project_uuid ON project_papers (project_uuid);
CREATE INDEX ix_project_papers_paper_sha256 ON project_papers (paper_sha256);
CREATE INDEX ix_project_papers_added_by ON project_papers (added_by);

-- A board the project holds. The board stays a board like any other, in
-- the table the replicas know, owned by the member who made it (its
-- changes are logged to them); this row is what lets every member edit
-- it, and what keeps it off the Library and out of other people's view.
CREATE TABLE project_boards (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	board_uuid VARCHAR(36) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_board UNIQUE (board_uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(board_uuid) REFERENCES boards (uuid)
);
CREATE INDEX ix_project_boards_project_uuid ON project_boards (project_uuid);
CREATE INDEX ix_project_boards_board_uuid ON project_boards (board_uuid);

-- A discussion: writing about one thing in a project. The thing can be
-- anything the project holds: the project itself, a paper, a member's
-- thought on a paper, a board, or a card on a board. `subject` names it
-- ("project", "paper:<sha256>", "take:<sha256>:<user>", "board:<uuid>",
-- "card:<uuid>"); the columns beside it point at the same thing so it can
-- be joined and cleaned up. One discussion per subject, so the place to
-- talk about something is always the same place.
CREATE TABLE discussions (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	subject VARCHAR(140) NOT NULL,
	paper_sha256 VARCHAR(64),
	take_user_uuid VARCHAR(36),
	board_uuid VARCHAR(36),
	board_item_uuid VARCHAR(36),
	started_by VARCHAR(36) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_discussion_subject UNIQUE (project_uuid, subject),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
	FOREIGN KEY(take_user_uuid) REFERENCES users (uuid),
	FOREIGN KEY(board_uuid) REFERENCES boards (uuid),
	FOREIGN KEY(board_item_uuid) REFERENCES board_items (uuid),
	FOREIGN KEY(started_by) REFERENCES users (uuid)
);
CREATE INDEX ix_discussions_project_uuid ON discussions (project_uuid);
CREATE INDEX ix_discussions_paper_sha256 ON discussions (paper_sha256);
CREATE INDEX ix_discussions_take_user_uuid ON discussions (take_user_uuid);
CREATE INDEX ix_discussions_board_uuid ON discussions (board_uuid);
CREATE INDEX ix_discussions_board_item_uuid ON discussions (board_item_uuid);
CREATE INDEX ix_discussions_started_by ON discussions (started_by);

-- What members wrote in a discussion, oldest first.
CREATE TABLE discussion_posts (
	uuid VARCHAR(36) NOT NULL,
	discussion_uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	body TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	edited_at DATETIME,
	PRIMARY KEY (uuid),
	FOREIGN KEY(discussion_uuid) REFERENCES discussions (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_discussion_posts_discussion_uuid ON discussion_posts (discussion_uuid);
CREATE INDEX ix_discussion_posts_user_uuid ON discussion_posts (user_uuid);
