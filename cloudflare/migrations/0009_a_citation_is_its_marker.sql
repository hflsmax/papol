-- A citation is one marker in the text, whole: the works it names and the
-- boxes it is printed in. A row was one work in one box, so "[3–5]" was
-- three rows and "Matsuda et al. 2007" broken over a line was two, and the
-- viewer had to guess from where they sat which rows were one marker. Now
-- the analyzer says, and a row is the marker: its boxes, one a printed line
-- in reading order, as JSON ([{"page","x","y","w","h"}]), and the works it
-- names in paper_citation_works, in the order printed.
--
-- paper_citations is derived from the PDF and holds nothing a user made.
-- Rows in the old shape cannot be told apart into markers, so they are
-- dropped, and every paper is marked for a fresh reading, which writes its
-- citations anew (and, as any re-analysis does, its references, floats and
-- links).

DROP TABLE paper_citations;

CREATE TABLE paper_citations (
	uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	label TEXT,
	inferred BOOLEAN,
	boxes TEXT NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_paper_citations_paper_sha256 ON paper_citations (paper_sha256);

CREATE TABLE paper_citation_works (
	uuid VARCHAR(36) NOT NULL,
	citation_uuid VARCHAR(36) NOT NULL,
	position INTEGER NOT NULL,
	reference_uuid VARCHAR(36) NOT NULL,
	PRIMARY KEY (uuid),
	FOREIGN KEY(citation_uuid) REFERENCES paper_citations (uuid),
	FOREIGN KEY(reference_uuid) REFERENCES paper_references (uuid)
);
CREATE INDEX ix_paper_citation_works_citation_uuid ON paper_citation_works (citation_uuid);
CREATE INDEX ix_paper_citation_works_reference_uuid ON paper_citation_works (reference_uuid);

UPDATE papers SET references_status = NULL, references_error = NULL, references_at = NULL;
