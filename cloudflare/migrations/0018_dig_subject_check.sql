-- A dig is about a paper, a card or an annotation, and nothing else: the
-- database holds it to that. Its subject key names exactly one of them, and
-- the link column for that kind is the one set (an annotation dig also
-- keeps the paper the annotation is on). Nothing can be stored as a dig
-- about another dig or a post.
PRAGMA defer_foreign_keys = true;

CREATE TABLE digs_checked (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36),
	subject VARCHAR(140) NOT NULL,
	paper_sha256 VARCHAR(64),
	board_item_uuid VARCHAR(36),
	annotation_uuid VARCHAR(36),
	text TEXT NOT NULL,
	edited_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	phase VARCHAR(16) NOT NULL DEFAULT 'digging' CHECK (phase IN ('digging', 'stashed', 'gold', 'buried')),
	PRIMARY KEY (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
	FOREIGN KEY(board_item_uuid) REFERENCES board_items (uuid),
	FOREIGN KEY(annotation_uuid) REFERENCES annotations (uuid),
	CONSTRAINT ck_dig_subject CHECK (
		(paper_sha256 IS NOT NULL AND board_item_uuid IS NULL AND annotation_uuid IS NULL AND subject = 'paper:' || paper_sha256)
		OR (board_item_uuid IS NOT NULL AND paper_sha256 IS NULL AND annotation_uuid IS NULL AND subject = 'card:' || board_item_uuid)
		OR (annotation_uuid IS NOT NULL AND board_item_uuid IS NULL AND subject = 'annotation:' || annotation_uuid)
	)
);

INSERT INTO digs_checked (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	SELECT uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase FROM digs
	WHERE (paper_sha256 IS NOT NULL AND board_item_uuid IS NULL AND annotation_uuid IS NULL AND subject = 'paper:' || paper_sha256)
		OR (board_item_uuid IS NOT NULL AND paper_sha256 IS NULL AND annotation_uuid IS NULL AND subject = 'card:' || board_item_uuid)
		OR (annotation_uuid IS NOT NULL AND board_item_uuid IS NULL AND subject = 'annotation:' || annotation_uuid);
DELETE FROM dig_posts WHERE dig_uuid NOT IN (SELECT uuid FROM digs_checked);

DROP TABLE digs;
ALTER TABLE digs_checked RENAME TO digs;

CREATE UNIQUE INDEX uq_dig_subject ON digs (user_uuid, subject, ifnull(project_uuid, ''));
CREATE INDEX ix_digs_project_uuid ON digs (project_uuid);
CREATE INDEX ix_digs_subject ON digs (subject);
CREATE INDEX ix_digs_paper_sha256 ON digs (paper_sha256);
CREATE INDEX ix_digs_board_item_uuid ON digs (board_item_uuid);
CREATE INDEX ix_digs_annotation_uuid ON digs (annotation_uuid);
