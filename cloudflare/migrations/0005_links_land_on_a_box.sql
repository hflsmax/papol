-- A paper's figures, tables and boxes are rows of their own — floats —
-- each with the box it covers on its page (caption and all), and a link in
-- the text names the float it points at rather than carrying a place. What
-- a float looks like is the float's; a link only says which.
--
-- paper_links is derived from the PDF and holds nothing a user made, so it
-- is rebuilt, and every paper is marked for a fresh reading, which writes
-- its floats and links (and, as any re-analysis does, its references and
-- citations).

DROP TABLE paper_links;

CREATE TABLE paper_floats (
	uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	kind VARCHAR NOT NULL,
	label TEXT NOT NULL,
	page INTEGER NOT NULL,
	x FLOAT NOT NULL,
	y FLOAT NOT NULL,
	w FLOAT NOT NULL,
	h FLOAT NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_paper_floats_paper_sha256 ON paper_floats (paper_sha256);

CREATE TABLE paper_links (
	uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	float_uuid VARCHAR(36) NOT NULL,
	label TEXT,
	page INTEGER NOT NULL,
	x FLOAT NOT NULL,
	y FLOAT NOT NULL,
	w FLOAT NOT NULL,
	h FLOAT NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
	FOREIGN KEY(float_uuid) REFERENCES paper_floats (uuid)
);
CREATE INDEX ix_paper_links_page ON paper_links (page);
CREATE INDEX ix_paper_links_paper_sha256 ON paper_links (paper_sha256);
CREATE INDEX ix_paper_links_float_uuid ON paper_links (float_uuid);

UPDATE papers SET references_status = NULL, references_error = NULL, references_at = NULL;
