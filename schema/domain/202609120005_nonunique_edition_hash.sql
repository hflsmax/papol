-- A content-addressed blob may back more than one edition row. Historical
-- uploads can also contain two edition identities for the same PDF, so the
-- digest is an indexed lookup key rather than a domain identity.
DROP INDEX IF EXISTS ix_paper_editions_sha256;
CREATE INDEX IF NOT EXISTS ix_paper_editions_sha256 ON paper_editions(sha256);
