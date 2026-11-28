-- A copy says whether its paper is kept in the nook.
--
-- Nobody needs a paper in their nook to read it or to write on it, so a
-- user's copy now begins with the first time they do either: the viewer
-- recording their time on it, or their first anchor, ink, clip or dig.
-- Such a copy is not kept. It sits on no shelf, nobody is shown it, and
-- their nook lists it under Passing: read but not kept. Adding the paper
-- to the nook keeps the same copy and gives it a shelf; taking it out
-- removes the copy as before, and it is Passing again.
--
-- Every copy that exists was put in a nook, so every one is kept.
--
-- A change to a synchronized table's shape, so the schema version moves:
-- a replica written under the old one is pulled again, and a build made
-- for the old one is told to update.

ALTER TABLE copies ADD COLUMN kept BOOLEAN DEFAULT '1' NOT NULL;

-- A copy, not kept, for every paper someone read or wrote on without one.
INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, kept, created_at, updated_at, revision)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
         || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       t.paper, t.user_uuid, NULL, 0, min(t.at), min(t.at), 1
FROM (
	SELECT user_uuid, paper_sha256 AS paper, coalesce(created_at, updated_at, datetime('now')) AS at FROM annotations
	UNION ALL
	SELECT user_uuid, paper_sha256, created_at FROM digs WHERE paper_sha256 IS NOT NULL AND board_item_uuid IS NULL
	UNION ALL
	SELECT user_uuid, subject, started_at FROM activity WHERE seconds > 0
) t
JOIN papers p ON p.sha256 = t.paper
JOIN users u ON u.uuid = t.user_uuid
WHERE NOT EXISTS (SELECT 1 FROM copies c WHERE c.user_uuid = t.user_uuid AND c.paper_sha256 = t.paper)
GROUP BY t.user_uuid, t.paper;

UPDATE settings SET value = '7' WHERE "key" = 'schema_version';
