-- The time a user spends with a paper open in the viewer or one of their
-- boards open, recorded as spans: one stretch of attention each, sent by
-- the window that saw it and named by that window, so sending a span again
-- as it grows changes it rather than adding another.
--
-- A span names its paper or board by the key alone and holds no foreign
-- key to either: a paper nobody holds any more can be collected
-- (scripts/gc-papers.py) without taking the time spent on it out of the
-- record. Only the user it belongs to is a key, and it goes with them.
-- Not synchronized: the desktop keeps its own outbox and sends spans as
-- the browser does, so no replica has the table.

CREATE TABLE activity (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	kind VARCHAR(8) NOT NULL,
	subject VARCHAR(64) NOT NULL,
	started_at DATETIME NOT NULL,
	ended_at DATETIME NOT NULL,
	seconds INTEGER NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_activity_user_uuid_started_at ON activity (user_uuid, started_at);
CREATE INDEX ix_activity_user_uuid_subject ON activity (user_uuid, subject);
