-- There are no notes. An anchor is a place on a page, and what anyone
-- writes there is their dig on it; what was written about a paper as a
-- whole is its writer's own dig on the paper. The words move into digs
-- and every located note becomes an anchor. Nothing is removed here:
-- the old words stay in annotations.content and .name, which nothing
-- reads, and the notes placed nowhere stay as they were, unread.

-- Anything written at an anchor since 0023 moved the words: the writer's
-- dig in every project holding the paper and the writer, else a dig of
-- their own.
INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	WITH note_words AS (
	SELECT a.uuid AS annotation_uuid, a.user_uuid, a.paper_sha256, a.created_at, a.updated_at,
		CASE
			WHEN TRIM(COALESCE(a.name, '')) <> '' AND TRIM(COALESCE(a.content, '')) <> '' THEN TRIM(a.name) || char(10) || char(10) || TRIM(a.content)
			WHEN TRIM(COALESCE(a.name, '')) <> '' THEN TRIM(a.name)
			ELSE TRIM(a.content)
		END AS words
	FROM annotations a
	WHERE a.kind = 'note' AND a.page IS NOT NULL AND a.deleted_at IS NULL AND a.paper_sha256 IS NOT NULL
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

INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	WITH note_words AS (
	SELECT a.uuid AS annotation_uuid, a.user_uuid, a.paper_sha256, a.created_at, a.updated_at,
		CASE
			WHEN TRIM(COALESCE(a.name, '')) <> '' AND TRIM(COALESCE(a.content, '')) <> '' THEN TRIM(a.name) || char(10) || char(10) || TRIM(a.content)
			WHEN TRIM(COALESCE(a.name, '')) <> '' THEN TRIM(a.name)
			ELSE TRIM(a.content)
		END AS words
	FROM annotations a
	WHERE a.kind = 'note' AND a.page IS NOT NULL AND a.deleted_at IS NULL AND a.paper_sha256 IS NOT NULL
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

-- What was written about the paper as a whole is its writer's own dig on
-- the paper, several notes joined oldest first.
INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, edited_at, created_at, updated_at, phase)
	SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
		w.user_uuid, NULL, 'paper:' || w.paper_sha256, w.paper_sha256, NULL, NULL, w.words, NULL, w.created_at, w.updated_at, 'digging'
	FROM (
		SELECT user_uuid, paper_sha256, group_concat(words, char(10) || char(10)) AS words, min(created_at) AS created_at, max(updated_at) AS updated_at
		FROM (
			SELECT a.user_uuid, a.paper_sha256, a.created_at, a.updated_at, TRIM(a.content) AS words
			FROM annotations a
			WHERE a.kind = 'note' AND a.page IS NULL AND a.deleted_at IS NULL AND TRIM(COALESCE(a.content, '')) <> ''
			ORDER BY a.created_at, a.uuid
		)
		GROUP BY user_uuid, paper_sha256
	) w
	WHERE NOT EXISTS (SELECT 1 FROM digs d WHERE d.user_uuid = w.user_uuid AND d.project_uuid IS NULL AND d.subject = 'paper:' || w.paper_sha256);

-- Every located note is an anchor.
UPDATE annotations SET kind = 'anchor' WHERE kind = 'note' AND page IS NOT NULL;

-- Replicas written before anchors hold no words are thrown away and pulled again.
UPDATE settings SET value = '5' WHERE "key" = 'schema_version';
