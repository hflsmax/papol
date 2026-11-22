-- Friends, and what the Lounge is made from.
--
-- A friend is someone a user asked, or who asked them, and the other
-- accepted: always mutual, one row to a pair whoever asked. `asked` waits
-- for an answer. `declined` is the asked one's quiet "Not now": the asker
-- is never told, and cannot ask again. `dropped` is a declined request
-- its asker took back, kept so that asking again is not a second request.
-- Ending a friendship removes the row, and either may ask again.
--
-- Nothing here is synchronized: friends are read online, as projects are.

CREATE TABLE friendships (
	uuid VARCHAR(36) NOT NULL,
	asker_uuid VARCHAR(36) NOT NULL,
	asked_uuid VARCHAR(36) NOT NULL,
	state VARCHAR(8) NOT NULL CHECK (state IN ('asked', 'declined', 'dropped', 'friends')),
	created_at DATETIME NOT NULL,
	answered_at DATETIME,
	PRIMARY KEY (uuid),
	CHECK (asker_uuid != asked_uuid),
	FOREIGN KEY(asker_uuid) REFERENCES users (uuid),
	FOREIGN KEY(asked_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_friendships_asker_uuid ON friendships (asker_uuid);
CREATE INDEX ix_friendships_asked_uuid ON friendships (asked_uuid);
CREATE UNIQUE INDEX uq_friendships_pair ON friendships (min(asker_uuid, asked_uuid), max(asker_uuid, asked_uuid));

-- A user asking a project's keeper to be let in: once per project, so
-- pressing Ask to join again tells the keeper nothing new.
CREATE TABLE project_asks (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_ask UNIQUE (project_uuid, user_uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_project_asks_project_uuid ON project_asks (project_uuid);
CREATE INDEX ix_project_asks_user_uuid ON project_asks (user_uuid);

-- When a copy's thought and ratings last changed: the news a copy makes
-- after it was added. A copy says only when it was last written at all,
-- which a move between shelves changes too. Named by the copy alone, with
-- no key to it, so it never stands in the way of a copy going.
CREATE TABLE copy_news (
	copy_uuid VARCHAR(36) NOT NULL,
	thought_at DATETIME,
	rated_at DATETIME,
	PRIMARY KEY (copy_uuid)
);

-- A user's friend link (the code is the whole of the permission, as a
-- project's invitation is), whether their friends see what they are
-- reading this week (off until they turn it on), and when they last
-- opened the Lounge: what friends did after that is new to them.
ALTER TABLE users ADD COLUMN friend_code VARCHAR(10);
ALTER TABLE users ADD COLUMN shares_reading BOOLEAN DEFAULT '0' NOT NULL;
ALTER TABLE users ADD COLUMN room_seen_at DATETIME;
CREATE UNIQUE INDEX ix_users_friend_code ON users (friend_code);

-- What a notification is, when it is more than its words: who it is from,
-- and where it leads. A friend request is answered where it is read.
ALTER TABLE notifications ADD COLUMN kind VARCHAR(24);
ALTER TABLE notifications ADD COLUMN actor_uuid VARCHAR(36) REFERENCES users (uuid);
ALTER TABLE notifications ADD COLUMN link VARCHAR(200);
CREATE INDEX ix_notifications_actor_uuid ON notifications (actor_uuid);
