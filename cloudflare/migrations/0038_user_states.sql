-- Small things a user's devices keep for them, one row per thing: where
-- they left each paper (kind 'place', key = the paper's sha256) and the
-- tips they have seen or dismissed (kind 'flag', key = the tip's storage
-- key). Each device keeps its own copy and sends a change when it can;
-- whichever change was made last wins (`at`), and every device takes the
-- rows back when it opens. The value is JSON, its shape the kind's.
--
-- reading_places (0037) was the first of these; its rows move here.
CREATE TABLE user_states (
	user_uuid VARCHAR(36) NOT NULL,
	kind VARCHAR(16) NOT NULL,
	"key" VARCHAR(80) NOT NULL,
	value TEXT,
	at DATETIME NOT NULL,
	PRIMARY KEY (user_uuid, kind, "key"),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_user_states_user_uuid ON user_states (user_uuid, kind, "key");

INSERT INTO user_states (user_uuid, kind, "key", value, at)
SELECT user_uuid, 'place', paper_sha256,
       json_object('page', page, 'x', x, 'y', y, 'scale', scale), read_at
FROM reading_places;

DROP TABLE reading_places;
