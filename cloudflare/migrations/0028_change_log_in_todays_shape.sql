-- The change log in the shape rows have now.
--
-- Anchors (0024) stopped carrying words and stopped being called notes,
-- and the replica's schema moved to 5 so every Mac threw its copy away and
-- pulled again from the start of the log. That log still held annotations
-- as they were written before: with `content` and `name`, which a replica
-- has no column for, and located ones still called `note`. A replica
-- pulling them refused the page, and so never synchronized.

UPDATE _server_change_log
SET row_json = json_remove(row_json, '$.content', '$.name')
WHERE table_name = 'annotations';

UPDATE _server_change_log
SET row_json = json_set(row_json, '$.kind', 'anchor')
WHERE table_name = 'annotations'
  AND json_extract(row_json, '$.kind') = 'note'
  AND json_extract(row_json, '$.page') IS NOT NULL;
