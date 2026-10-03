-- A project's board is the project's, not its maker's: on no shelf, and
-- held by no replica (cloudflare/src/sync/write.ts boardReplica). What the
-- change log still holds of one would only put it back in its maker's
-- replica, so it goes too.
UPDATE boards SET shelf_uuid = NULL WHERE uuid IN (SELECT board_uuid FROM project_boards);

DELETE FROM _server_change_log WHERE
	(table_name = 'boards' AND row_uuid IN (SELECT board_uuid FROM project_boards))
	OR (table_name = 'board_groups' AND row_uuid IN (SELECT uuid FROM board_groups WHERE board_uuid IN (SELECT board_uuid FROM project_boards)))
	OR (table_name = 'board_items' AND row_uuid IN (SELECT uuid FROM board_items WHERE board_uuid IN (SELECT board_uuid FROM project_boards)));
