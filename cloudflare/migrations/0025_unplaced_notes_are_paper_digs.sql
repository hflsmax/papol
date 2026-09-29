-- A note placed nowhere was about the paper as a whole, yet 0023 made it
-- its author's dig on the note itself, which is no place: the project
-- listed it as "An annotation". Each such dig becomes its writer's dig
-- on the paper, in the same project (or none), where they have not dug
-- the paper there already; the oldest one first where there are several.
-- Nothing is removed: any left over stay unshown, their words already
-- in the writer's dig on the paper or theirs to write again.
UPDATE digs SET subject = 'paper:' || paper_sha256, annotation_uuid = NULL
	WHERE uuid IN (
		SELECT n.uuid FROM digs n JOIN annotations a ON a.uuid = n.annotation_uuid
		WHERE a.kind = 'note' AND a.page IS NULL AND n.paper_sha256 IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM digs p WHERE p.user_uuid = n.user_uuid
				AND ifnull(p.project_uuid, '') = ifnull(n.project_uuid, '') AND p.subject = 'paper:' || n.paper_sha256)
			AND NOT EXISTS (SELECT 1 FROM digs o JOIN annotations oa ON oa.uuid = o.annotation_uuid
				WHERE oa.kind = 'note' AND oa.page IS NULL AND o.user_uuid = n.user_uuid
					AND ifnull(o.project_uuid, '') = ifnull(n.project_uuid, '') AND o.paper_sha256 = n.paper_sha256
					AND (o.created_at < n.created_at OR (o.created_at = n.created_at AND o.uuid < n.uuid))));
