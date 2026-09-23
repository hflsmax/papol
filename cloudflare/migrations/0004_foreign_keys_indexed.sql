-- Every foreign key column gets an index.
--
-- Deleting a row makes SQLite look for rows that point at it, and without
-- an index on the pointing column that look is a scan of the whole child
-- table, once per deleted row. On 2026-09-23 dropping paper_references
-- (2,469 rows) scanned paper_citations (3,878 rows) for each of them: 9.6
-- million rows read per refresh of dev, and the account's free daily
-- allowance of reads spent by two refreshes. The same scans stand behind
-- closing an account (auth_tokens, rooms, room_*), letting a paper go and
-- the ordinary lookups that filter on these columns.

CREATE INDEX IF NOT EXISTS ix_paper_citations_reference_uuid ON paper_citations (reference_uuid);
CREATE INDEX IF NOT EXISTS ix_auth_tokens_user_uuid ON auth_tokens (user_uuid);
CREATE INDEX IF NOT EXISTS ix_papers_uploaded_by ON papers (uploaded_by);
CREATE INDEX IF NOT EXISTS ix_admin_messages_created_by_uuid ON admin_messages (created_by_uuid);
CREATE INDEX IF NOT EXISTS ix_rooms_created_by ON rooms (created_by);
CREATE INDEX IF NOT EXISTS ix_rooms_leader_uuid ON rooms (leader_uuid);
CREATE INDEX IF NOT EXISTS ix_notifications_room_uuid ON notifications (room_uuid);
CREATE INDEX IF NOT EXISTS ix_room_availabilities_user_uuid ON room_availabilities (user_uuid);
CREATE INDEX IF NOT EXISTS ix_room_messages_user_uuid ON room_messages (user_uuid);
CREATE INDEX IF NOT EXISTS ix_room_participants_user_uuid ON room_participants (user_uuid);
