-- People Papol suggests a user ask to be friends, in the Lounge and in a
-- weekly email.
--
-- A suggestion is not kept: it is read off what is already there (a
-- project two users are both in, papers both keep on public shelves) each
-- time it is asked for. What is kept is only what the user was already
-- told and what they said no to: `hidden_at` once they pressed Not
-- interested, so the person is not suggested to them again, and
-- `mailed_at` once the weekly email named the person, so no email names
-- them twice.
CREATE TABLE friend_suggestions (
	user_uuid VARCHAR(36) NOT NULL,
	suggested_uuid VARCHAR(36) NOT NULL,
	hidden_at DATETIME,
	mailed_at DATETIME,
	PRIMARY KEY (user_uuid, suggested_uuid),
	CHECK (user_uuid != suggested_uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid),
	FOREIGN KEY(suggested_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_friend_suggestions_user_uuid ON friend_suggestions (user_uuid, suggested_uuid);
CREATE INDEX ix_friend_suggestions_suggested_uuid ON friend_suggestions (suggested_uuid);

-- Whether the weekly email of suggestions is sent to this user (on until
-- they turn it off, in Preferences or by the link in the email itself).
ALTER TABLE users ADD COLUMN suggestion_email BOOLEAN DEFAULT '1' NOT NULL;

-- What that link carries in place of a sign-in: a secret minted the first
-- time the user is sent the email, good only for turning it off.
ALTER TABLE users ADD COLUMN unsubscribe_token VARCHAR(64);
CREATE UNIQUE INDEX uq_users_unsubscribe_token ON users (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;
