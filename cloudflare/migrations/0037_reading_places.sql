-- Where a user last left each paper open: the point at the middle of the
-- viewer, as fractions of its page, and the zoom it was read at. One row
-- per user and paper, so the website and the Mac open a paper where the
-- other left it. Not synchronized: the place is sent as the reader moves
-- and read back when the paper opens, by the browser and the Mac alike.
--
-- Like activity, it names its paper by the key alone: a paper nobody holds
-- any more can be collected without asking about this.
CREATE TABLE reading_places (
	user_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	page INTEGER NOT NULL,
	x REAL NOT NULL,
	y REAL NOT NULL,
	scale REAL NOT NULL,
	read_at DATETIME NOT NULL,
	PRIMARY KEY (user_uuid, paper_sha256),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_reading_places_user_uuid ON reading_places (user_uuid, paper_sha256);
