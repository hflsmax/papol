-- A dig: one person's writing about one thing. It is theirs: they started
-- it, and a thing holds one dig per person. Anyone who can see a dig can
-- post in it. A dig is never about another dig.
--
-- `subject` names the thing ("paper:<sha256>", "board:<uuid>",
-- "card:<uuid>", "annotation:<uuid>", and "take:<sha256>:
-- <user>" until thoughts become digs themselves); the columns beside it
-- point at the same thing so it can be joined and cleaned up. A dig in a
-- project is seen by its members; `project_uuid` is null for none.
--
-- Discussions move here as they were, each under the member who started
-- it, with every post it holds, whoever wrote it. The old tables stay
-- untouched until nothing reads them.

CREATE TABLE digs (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36),
	subject VARCHAR(140) NOT NULL,
	paper_sha256 VARCHAR(64),
	take_user_uuid VARCHAR(36),
	board_uuid VARCHAR(36),
	board_item_uuid VARCHAR(36),
	annotation_uuid VARCHAR(36),
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
	FOREIGN KEY(take_user_uuid) REFERENCES users (uuid),
	FOREIGN KEY(board_uuid) REFERENCES boards (uuid),
	FOREIGN KEY(board_item_uuid) REFERENCES board_items (uuid),
	FOREIGN KEY(annotation_uuid) REFERENCES annotations (uuid)
);
CREATE UNIQUE INDEX uq_dig_subject ON digs (user_uuid, subject, ifnull(project_uuid, ''));
CREATE INDEX ix_digs_project_uuid ON digs (project_uuid);
CREATE INDEX ix_digs_subject ON digs (subject);
CREATE INDEX ix_digs_paper_sha256 ON digs (paper_sha256);
CREATE INDEX ix_digs_take_user_uuid ON digs (take_user_uuid);
CREATE INDEX ix_digs_board_uuid ON digs (board_uuid);
CREATE INDEX ix_digs_board_item_uuid ON digs (board_item_uuid);
CREATE INDEX ix_digs_annotation_uuid ON digs (annotation_uuid);

-- What was written in a dig, oldest first.
CREATE TABLE dig_posts (
	uuid VARCHAR(36) NOT NULL,
	dig_uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	body TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	edited_at DATETIME,
	PRIMARY KEY (uuid),
	FOREIGN KEY(dig_uuid) REFERENCES digs (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_dig_posts_dig_uuid ON dig_posts (dig_uuid);
CREATE INDEX ix_dig_posts_user_uuid ON dig_posts (user_uuid);

INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, take_user_uuid, board_uuid, board_item_uuid, annotation_uuid, created_at, updated_at)
	SELECT uuid, started_by, project_uuid, subject, paper_sha256, take_user_uuid, board_uuid, board_item_uuid, annotation_uuid, created_at, updated_at
	FROM discussions;
INSERT INTO dig_posts (uuid, dig_uuid, user_uuid, body, created_at, edited_at)
	SELECT uuid, discussion_uuid, user_uuid, body, created_at, edited_at FROM discussion_posts;
