-- The papers a user has written on, remembered for good.
--
-- Nobody needs a paper in their nook to mark it, so what they marked
-- needs a place of its own to be found again. A paper is remembered from
-- its writer's first anchor, ink, clip or dig on it, and never forgotten:
-- adding it to the nook, taking it out, and rubbing the marks out again
-- all leave the row. Their nook lists the ones no shelf of theirs holds,
-- with the papers they read, as Passing (routes/nook.ts), theirs alone.
--
-- Kept by the database rather than by each road a mark can arrive on —
-- the website, a replica's push, a first thought written at upload — so
-- none of them can forget. It is the server's own and no replica's: the
-- synchronized tables keep their shape and the schema version stays.

CREATE TABLE marked_papers (
	user_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	marked_at DATETIME NOT NULL,
	PRIMARY KEY (user_uuid, paper_sha256),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_marked_papers_user_uuid ON marked_papers (user_uuid);
CREATE INDEX ix_marked_papers_paper_sha256 ON marked_papers (paper_sha256);

CREATE TRIGGER marked_by_annotation AFTER INSERT ON annotations
BEGIN
	INSERT OR IGNORE INTO marked_papers (user_uuid, paper_sha256, marked_at)
	VALUES (NEW.user_uuid, NEW.paper_sha256, coalesce(NEW.created_at, datetime('now')));
END;

-- A dig on a paper or on a mark on one. A dig on a card is its project's
-- and about no paper of the writer's.
CREATE TRIGGER marked_by_dig AFTER INSERT ON digs
WHEN NEW.paper_sha256 IS NOT NULL AND NEW.board_item_uuid IS NULL
BEGIN
	INSERT OR IGNORE INTO marked_papers (user_uuid, paper_sha256, marked_at)
	VALUES (NEW.user_uuid, NEW.paper_sha256, NEW.created_at);
END;

-- Everything written before the list was kept, by when it was first written.
INSERT OR IGNORE INTO marked_papers (user_uuid, paper_sha256, marked_at)
SELECT user_uuid, paper_sha256, min(at) FROM (
	SELECT user_uuid, paper_sha256, coalesce(created_at, updated_at, datetime('now')) AS at FROM annotations
	UNION ALL
	SELECT user_uuid, paper_sha256, created_at FROM digs WHERE paper_sha256 IS NOT NULL AND board_item_uuid IS NULL
) GROUP BY user_uuid, paper_sha256;
