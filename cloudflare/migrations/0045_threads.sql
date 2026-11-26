-- Threads: the Lounge's free-form talk. A user sends something they
-- selected in a paper (words, or a clipped rectangle as a picture) to
-- the Lounge with words of their own, and their friends reply.
--
-- A thread is seen by its starter and the starter's friends, and by
-- nobody else; whoever sees it can reply, and every reply is seen by all
-- who see the thread. Nothing here marks the paper: a thread lives in the
-- Lounge alone, and keeps the place it came from only to lead back there.
-- There are no votes and no counts of approval.
--
-- The place is the viewer's own, kept as the viewer writes it in its
-- address: the page, where on it (`y`), and the highlight drawn on
-- arriving (`mark` for lines of text, `box` for a rectangle). The picture is named by its digest and kept where
-- board files are.
--
-- Not synchronized: threads are read online, as friends are. Like
-- defined_terms, a thread names its paper by the key alone.
CREATE TABLE threads (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	page INTEGER NOT NULL,
	y REAL NOT NULL,
	mark TEXT,
	box TEXT,
	excerpt TEXT,
	picture_sha256 VARCHAR(64),
	words TEXT,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CHECK (excerpt IS NOT NULL OR picture_sha256 IS NOT NULL),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
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
CREATE INDEX ix_thread_replies_thread_uuid ON thread_replies (thread_uuid, created_at);
CREATE INDEX ix_thread_replies_user_uuid ON thread_replies (user_uuid);
