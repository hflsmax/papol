-- Where the port simplified the schema, and why (docs/cloud-migration.md,
-- phase 4). 0001 is the Python backend's schema verbatim; this is what the
-- Worker changed on arrival.
--
-- applied_mutations kept the reply to any identified mutation on any route:
-- method, path, status, content type and body. No shipped client ever sent
-- the two headers that identified one; only the sync push did, through its
-- own body, and its reply is JSON. So the row is the push's reply and
-- nothing else, and the middleware that stored every other route's is gone.

DROP TABLE applied_mutations;
CREATE TABLE applied_mutations (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	client_uuid VARCHAR(36) NOT NULL,
	mutation_uuid VARCHAR(36) NOT NULL,
	request_hash VARCHAR(64) NOT NULL,
	response_json TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_applied_mutation_identity UNIQUE (user_uuid, client_uuid, mutation_uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_applied_mutations_user_uuid ON applied_mutations (user_uuid);
