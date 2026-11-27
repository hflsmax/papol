-- A thread can be started in the Lounge itself, from no paper: words of
-- the starter's own, and pictures and files they attach. So the paper and
-- the place in it become optional. A thread from a paper is still
-- something selected or a picture; one from no paper is words, files, or
-- both, which the route sees to since the files are rows of their own.
--
-- SQLite cannot loosen a column or a check in place, so the table is
-- built again. Its replies point at it, so they step aside first and
-- come back after.
CREATE TABLE thread_replies_kept AS SELECT * FROM thread_replies;
DROP TABLE thread_replies;

CREATE TABLE threads_loosened (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64),
	page INTEGER,
	y REAL,
	mark TEXT,
	box TEXT,
	excerpt TEXT,
	picture_sha256 VARCHAR(64),
	words TEXT,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CHECK (paper_sha256 IS NULL OR excerpt IS NOT NULL OR picture_sha256 IS NOT NULL),
	-- Something from a paper names the paper and the place; words alone name neither.
	CHECK ((paper_sha256 IS NOT NULL AND page IS NOT NULL AND y IS NOT NULL) OR (paper_sha256 IS NULL AND page IS NULL AND y IS NULL AND mark IS NULL AND box IS NULL AND excerpt IS NULL AND picture_sha256 IS NULL)),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
INSERT INTO threads_loosened (uuid, user_uuid, paper_sha256, page, y, mark, box, excerpt, picture_sha256, words, created_at)
	SELECT uuid, user_uuid, paper_sha256, page, y, mark, box, excerpt, picture_sha256, words, created_at FROM threads;
DROP TABLE threads;
ALTER TABLE threads_loosened RENAME TO threads;
CREATE INDEX ix_threads_user_uuid ON threads (user_uuid, created_at);
CREATE INDEX ix_threads_picture_sha256 ON threads (picture_sha256);

CREATE TABLE thread_replies (
	uuid VARCHAR(36) NOT NULL,
	thread_uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	body TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(thread_uuid) REFERENCES threads (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
INSERT INTO thread_replies (uuid, thread_uuid, user_uuid, body, created_at)
	SELECT uuid, thread_uuid, user_uuid, body, created_at FROM thread_replies_kept;
DROP TABLE thread_replies_kept;
CREATE INDEX ix_thread_replies_thread_uuid ON thread_replies (thread_uuid, created_at);
CREATE INDEX ix_thread_replies_user_uuid ON thread_replies (user_uuid);

-- What a thread's starter attached to it: pictures, shown in the thread,
-- and files, offered to be opened. Each is named by its digest and kept
-- where board files are; the name and type are as the starter's own
-- computer gave them.
CREATE TABLE thread_files (
	uuid VARCHAR(36) NOT NULL,
	thread_uuid VARCHAR(36) NOT NULL,
	sha256 VARCHAR(64) NOT NULL,
	name VARCHAR(255) NOT NULL,
	mime VARCHAR(255),
	size INTEGER NOT NULL,
	position INTEGER NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(thread_uuid) REFERENCES threads (uuid)
);
CREATE INDEX ix_thread_files_thread_uuid ON thread_files (thread_uuid, position);
CREATE INDEX ix_thread_files_sha256 ON thread_files (sha256);
