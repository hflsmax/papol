-- A term a user defined in a paper: words they selected, and the
-- definition in the same paper they pointed them at. Wherever the words
-- are printed in that paper, the viewer shows that user the definition,
-- as it shows a named rule at its mention.
--
-- The definition is kept as the place it is printed (its page and its
-- box, as screen-space fractions) and what the paper calls it, not as a
-- name the analyzer gave it: a reading is each device's own.
-- `term_key` is the term as it is matched, without case or spacing: one
-- row per user, paper and term, so defining a term again moves it.
--
-- Not synchronized: the viewer asks for a paper's terms when it opens it,
-- in the browser and on the Mac alike. Like user_states, it names its
-- paper by the key alone.
CREATE TABLE defined_terms (
	uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	term VARCHAR(120) NOT NULL,
	term_key VARCHAR(120) NOT NULL,
	label VARCHAR(120) NOT NULL,
	page INTEGER NOT NULL,
	x REAL NOT NULL,
	y REAL NOT NULL,
	w REAL NOT NULL,
	h REAL NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_defined_term UNIQUE (user_uuid, paper_sha256, term_key),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_defined_terms_user_uuid ON defined_terms (user_uuid, paper_sha256);
