-- A recent authenticated heartbeat says a person is in Papol. Presence is
-- transient product state, not part of somebody's profile or account history.
CREATE TABLE user_presence (
	user_uuid VARCHAR(36) PRIMARY KEY NOT NULL,
	last_seen_at TIMESTAMP NOT NULL,
	FOREIGN KEY(user_uuid) REFERENCES users (uuid) ON DELETE CASCADE
);

CREATE INDEX ix_user_presence_user_uuid ON user_presence (user_uuid);
