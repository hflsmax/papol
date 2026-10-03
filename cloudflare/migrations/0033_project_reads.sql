-- A project's news is acknowledged at the item where it was actually read.
-- `project_members.seen_at` remains the baseline for members created before
-- this table and for the explicit "mark all read" action.
CREATE TABLE project_member_reads (
	member_uuid VARCHAR(36) NOT NULL,
	item_kind VARCHAR(12) NOT NULL CHECK (item_kind IN ('paper', 'board', 'dig')),
	item_uuid VARCHAR(64) NOT NULL,
	seen_at DATETIME NOT NULL,
	PRIMARY KEY (member_uuid, item_kind, item_uuid),
	FOREIGN KEY(member_uuid) REFERENCES project_members (uuid) ON DELETE CASCADE
);
CREATE INDEX ix_project_member_reads_member_uuid ON project_member_reads (member_uuid);
