-- A project has one keeper. Where a project had several, the one who
-- joined first keeps it and the others stay on as members; the index
-- holds it from here on.
UPDATE project_members SET is_keeper = 0
WHERE is_keeper = 1 AND uuid NOT IN (
	SELECT (SELECT k.uuid FROM project_members k
	        WHERE k.project_uuid = m.project_uuid AND k.is_keeper = 1
	        ORDER BY k.joined_at, k.uuid LIMIT 1)
	FROM project_members m WHERE m.is_keeper = 1
);

CREATE UNIQUE INDEX project_members_one_keeper ON project_members (project_uuid) WHERE is_keeper = 1;
