-- Short-lived, single-use credentials for recovering an account. Only the
-- digest is retained, so a database read cannot turn into a password reset.
CREATE TABLE password_resets (
	token_hash VARCHAR(64) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	created_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	used_at DATETIME,
	PRIMARY KEY (token_hash),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_password_resets_user_uuid ON password_resets (user_uuid);
CREATE INDEX ix_password_resets_expires_at ON password_resets (expires_at);
