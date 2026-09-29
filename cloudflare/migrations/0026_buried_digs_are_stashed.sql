-- Buried is gone: a dig is digging, stashed or gold. Every buried dig is
-- stashed now, and the database holds the phase to those three.
--
-- The posts stand aside while digs is rebuilt: dropping a table that other
-- rows point at leaves a violation SQLite still counts at commit, even once
-- a table of the same name and rows is back.
CREATE TABLE dig_posts_kept AS SELECT * FROM dig_posts;
DROP TABLE dig_posts;

CREATE TABLE digs_phased (
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
	phase VARCHAR(16) NOT NULL DEFAULT 'digging' CHECK (phase IN ('digging', 'stashed', 'gold')),
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

INSERT INTO digs_phased (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	SELECT uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at,
		CASE phase WHEN 'buried' THEN 'stashed' ELSE phase END FROM digs;

DROP TABLE digs;
ALTER TABLE digs_phased RENAME TO digs;

CREATE UNIQUE INDEX uq_dig_subject ON digs (user_uuid, subject, ifnull(project_uuid, ''));
CREATE INDEX ix_digs_project_uuid ON digs (project_uuid);
CREATE INDEX ix_digs_subject ON digs (subject);
CREATE INDEX ix_digs_paper_sha256 ON digs (paper_sha256);
CREATE INDEX ix_digs_board_item_uuid ON digs (board_item_uuid);
CREATE INDEX ix_digs_annotation_uuid ON digs (annotation_uuid);

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
INSERT INTO dig_posts (uuid, dig_uuid, user_uuid, body, created_at, edited_at)
	SELECT uuid, dig_uuid, user_uuid, body, created_at, edited_at FROM dig_posts_kept;
DROP TABLE dig_posts_kept;
CREATE INDEX ix_dig_posts_dig_uuid ON dig_posts (dig_uuid);
CREATE INDEX ix_dig_posts_user_uuid ON dig_posts (user_uuid);
