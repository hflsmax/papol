-- A note is its author's dig at its place. Each live note with words
-- becomes its author's dig on its anchor in every project that holds both
-- the paper and the author, and, for a note in no such project, a dig of
-- the author's own (no project). A name and words are joined, the name
-- first. Where the author has already dug their own anchor in a project,
-- the note's words go at the head of that dig. Nothing is removed: the
-- anchors keep their words until the viewer no longer reads them.

-- The author's own digs on their anchors take the note's words first.
WITH note_words AS (
	SELECT a.uuid AS annotation_uuid, a.user_uuid, a.paper_sha256, a.created_at, a.updated_at,
		CASE
			WHEN TRIM(COALESCE(a.name, '')) <> '' AND TRIM(COALESCE(a.content, '')) <> '' THEN TRIM(a.name) || char(10) || char(10) || TRIM(a.content)
			WHEN TRIM(COALESCE(a.name, '')) <> '' THEN TRIM(a.name)
			ELSE TRIM(a.content)
		END AS words
	FROM annotations a
	WHERE a.kind = 'note' AND a.deleted_at IS NULL AND a.paper_sha256 IS NOT NULL
		AND (TRIM(COALESCE(a.content, '')) <> '' OR TRIM(COALESCE(a.name, '')) <> '')
), note_projects AS (
	SELECT n.annotation_uuid, pp.project_uuid
	FROM note_words n
	JOIN project_papers pp ON pp.paper_sha256 = n.paper_sha256
	JOIN project_members m ON m.project_uuid = pp.project_uuid AND m.user_uuid = n.user_uuid
	JOIN projects p ON p.uuid = pp.project_uuid AND p.deleted_at IS NULL
)
UPDATE digs SET text = (SELECT n.words FROM note_words n WHERE n.annotation_uuid = digs.annotation_uuid) || char(10) || char(10) || text
	WHERE EXISTS (SELECT 1 FROM note_words n JOIN note_projects np ON np.annotation_uuid = n.annotation_uuid
		WHERE n.annotation_uuid = digs.annotation_uuid AND n.user_uuid = digs.user_uuid AND np.project_uuid = digs.project_uuid);

-- Every other project the note is seen in gets the author's dig.
INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	WITH note_words AS (
	SELECT a.uuid AS annotation_uuid, a.user_uuid, a.paper_sha256, a.created_at, a.updated_at,
		CASE
			WHEN TRIM(COALESCE(a.name, '')) <> '' AND TRIM(COALESCE(a.content, '')) <> '' THEN TRIM(a.name) || char(10) || char(10) || TRIM(a.content)
			WHEN TRIM(COALESCE(a.name, '')) <> '' THEN TRIM(a.name)
			ELSE TRIM(a.content)
		END AS words
	FROM annotations a
	WHERE a.kind = 'note' AND a.deleted_at IS NULL AND a.paper_sha256 IS NOT NULL
		AND (TRIM(COALESCE(a.content, '')) <> '' OR TRIM(COALESCE(a.name, '')) <> '')
), note_projects AS (
	SELECT n.annotation_uuid, pp.project_uuid
	FROM note_words n
	JOIN project_papers pp ON pp.paper_sha256 = n.paper_sha256
	JOIN project_members m ON m.project_uuid = pp.project_uuid AND m.user_uuid = n.user_uuid
	JOIN projects p ON p.uuid = pp.project_uuid AND p.deleted_at IS NULL
)
	SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
		n.user_uuid, np.project_uuid, 'annotation:' || n.annotation_uuid, n.paper_sha256, NULL, n.annotation_uuid, n.words, NULL, n.created_at, n.updated_at, 'digging'
	FROM note_words n JOIN note_projects np ON np.annotation_uuid = n.annotation_uuid
	WHERE NOT EXISTS (SELECT 1 FROM digs d WHERE d.user_uuid = n.user_uuid AND d.project_uuid = np.project_uuid AND d.subject = 'annotation:' || n.annotation_uuid);

-- A note in no project is the author's dig of their own.
INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	WITH note_words AS (
	SELECT a.uuid AS annotation_uuid, a.user_uuid, a.paper_sha256, a.created_at, a.updated_at,
		CASE
			WHEN TRIM(COALESCE(a.name, '')) <> '' AND TRIM(COALESCE(a.content, '')) <> '' THEN TRIM(a.name) || char(10) || char(10) || TRIM(a.content)
			WHEN TRIM(COALESCE(a.name, '')) <> '' THEN TRIM(a.name)
			ELSE TRIM(a.content)
		END AS words
	FROM annotations a
	WHERE a.kind = 'note' AND a.deleted_at IS NULL AND a.paper_sha256 IS NOT NULL
		AND (TRIM(COALESCE(a.content, '')) <> '' OR TRIM(COALESCE(a.name, '')) <> '')
), note_projects AS (
	SELECT n.annotation_uuid, pp.project_uuid
	FROM note_words n
	JOIN project_papers pp ON pp.paper_sha256 = n.paper_sha256
	JOIN project_members m ON m.project_uuid = pp.project_uuid AND m.user_uuid = n.user_uuid
	JOIN projects p ON p.uuid = pp.project_uuid AND p.deleted_at IS NULL
)
	SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
		n.user_uuid, NULL, 'annotation:' || n.annotation_uuid, n.paper_sha256, NULL, n.annotation_uuid, n.words, NULL, n.created_at, n.updated_at, 'digging'
	FROM note_words n
	WHERE NOT EXISTS (SELECT 1 FROM note_projects np WHERE np.annotation_uuid = n.annotation_uuid)
		AND NOT EXISTS (SELECT 1 FROM digs d WHERE d.user_uuid = n.user_uuid AND d.project_uuid IS NULL AND d.subject = 'annotation:' || n.annotation_uuid);
