-- A dig on a paper, or on a mark on one, is its writer's own and no
-- project's: the people they share a project with see it there while the
-- writer keeps the paper on a public shelf (the rule agreed 2026-11-17).
-- Digs on cards stay their project's.
--
-- Every dig written in a project on a paper or a mark becomes its writer's
-- own. Where a writer has more than one on the same thing (their own and
-- one per project), they become one: the oldest of their own, else the
-- oldest, keeps its phase and gains the others' words after its own, in
-- the order written, and every post in them. Each writer who did not keep
-- the paper is given it back on their default shelf, so what they wrote
-- stays where it was seen. Nothing anyone wrote is dropped.

-- The writers who no longer keep a paper they dug in a project: a removed
-- copy comes back, on the default shelf; a missing one is made there.
UPDATE copies SET deleted_at = NULL,
	shelf_uuid = coalesce((SELECT s.uuid FROM shelves s WHERE s.user_uuid = copies.user_uuid AND s.is_default = 1 AND s.deleted_at IS NULL LIMIT 1), shelf_uuid),
	updated_at = CURRENT_TIMESTAMP, revision = revision + 1
WHERE deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM digs d
	WHERE d.user_uuid = copies.user_uuid AND d.paper_sha256 = copies.paper_sha256 AND d.project_uuid IS NOT NULL AND d.board_item_uuid IS NULL);

INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, created_at, updated_at, revision)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	w.paper_sha256, w.user_uuid,
	(SELECT s.uuid FROM shelves s WHERE s.user_uuid = w.user_uuid AND s.is_default = 1 AND s.deleted_at IS NULL LIMIT 1),
	CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
FROM (SELECT DISTINCT d.user_uuid, d.paper_sha256 FROM digs d
	WHERE d.project_uuid IS NOT NULL AND d.board_item_uuid IS NULL AND d.paper_sha256 IS NOT NULL) w
WHERE NOT EXISTS (SELECT 1 FROM copies c WHERE c.user_uuid = w.user_uuid AND c.paper_sha256 = w.paper_sha256);

-- Which dig each one on a paper or a mark becomes.
CREATE TABLE dig_folds (uuid VARCHAR(36) NOT NULL PRIMARY KEY, keeper VARCHAR(36) NOT NULL);
INSERT INTO dig_folds (uuid, keeper)
SELECT d.uuid, (SELECT k.uuid FROM digs k
	WHERE k.user_uuid = d.user_uuid AND k.subject = d.subject AND k.board_item_uuid IS NULL
	ORDER BY k.project_uuid IS NOT NULL, k.created_at, k.uuid LIMIT 1)
FROM digs d WHERE d.board_item_uuid IS NULL;
DELETE FROM dig_folds WHERE uuid = keeper;

-- The keeper's words, then each folded dig's, in the order written.
UPDATE digs SET text = text || (
	SELECT group_concat(words, '') FROM (
		SELECT char(10) || char(10) || x.text AS words FROM dig_folds f JOIN digs x ON x.uuid = f.uuid
		WHERE f.keeper = digs.uuid ORDER BY x.created_at, x.uuid)),
	updated_at = max(updated_at, (SELECT max(x.updated_at) FROM dig_folds f JOIN digs x ON x.uuid = f.uuid WHERE f.keeper = digs.uuid))
WHERE uuid IN (SELECT keeper FROM dig_folds);

UPDATE dig_posts SET dig_uuid = (SELECT f.keeper FROM dig_folds f WHERE f.uuid = dig_posts.dig_uuid)
WHERE dig_uuid IN (SELECT uuid FROM dig_folds);

DELETE FROM project_member_reads WHERE item_kind = 'dig' AND item_uuid IN (SELECT uuid FROM dig_folds);
DELETE FROM digs WHERE uuid IN (SELECT uuid FROM dig_folds);
DROP TABLE dig_folds;

UPDATE digs SET project_uuid = NULL WHERE project_uuid IS NOT NULL AND board_item_uuid IS NULL;
