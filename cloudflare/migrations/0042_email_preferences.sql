-- What Papol emails a user, and how often, is chosen in one place.
--
-- `email_frequency` keeps how often the user is sent each kind of email
-- they changed from where it starts: a JSON object, kind to frequency
-- (`now`, `daily`, `weekly`, `never`), of the kinds src/emails.ts
-- declares. Empty, every kind is at its preset. A kind of email added
-- later needs no migration.
--
-- The one choice there was, the weekly suggestions' own column, becomes
-- an entry in it.
ALTER TABLE users ADD COLUMN email_frequency TEXT DEFAULT '{}' NOT NULL;
UPDATE users SET email_frequency = '{"friend_suggestions":"never"}' WHERE suggestion_email = 0;
ALTER TABLE users DROP COLUMN suggestion_email;

-- An email waiting for the day's or the week's: one a user chose to be
-- sent daily or weekly, kept as it would have been sent, until the job
-- that gathers them (src/jobs/digests.ts) sends it and deletes the row.
CREATE TABLE email_held (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	kind VARCHAR(40) NOT NULL,
	subject TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_email_held_user_uuid ON email_held (user_uuid, created_at);
