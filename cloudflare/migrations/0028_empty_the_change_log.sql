-- Empty the change log.
--
-- It held rows as they were written, among them annotations from before
-- anchors, with `content` and `name` a replica has no column for. Schema 5
-- made every replica start again, pulling the log from its beginning, and
-- that page was refused. A replica now starts pulling where its snapshot
-- was taken, so nothing logged before today is ever read again.
-- AUTOINCREMENT keeps the sequence growing past what any replica holds.
DELETE FROM _server_change_log;
