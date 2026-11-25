-- A note became its writer's dig (0023), and a note placed nowhere became
-- their dig on the paper (0025). Some digs were left on the note itself,
-- which is no place: nobody is shown them, their writer included, and
-- they are only counted. Each one here says nothing its writer's own dig
-- on the paper does not already say, and nobody posted in it, so it goes.
-- One with words found nowhere else, or with a post in it, stays.
CREATE TABLE note_digs_left_over (uuid VARCHAR(36) NOT NULL PRIMARY KEY);
INSERT INTO note_digs_left_over (uuid)
SELECT d.uuid FROM digs d JOIN annotations a ON a.uuid = d.annotation_uuid
WHERE a.kind = 'note'
	AND NOT EXISTS (SELECT 1 FROM dig_posts dp WHERE dp.dig_uuid = d.uuid)
	AND EXISTS (SELECT 1 FROM digs p WHERE p.user_uuid = d.user_uuid AND p.project_uuid IS NULL
		AND p.subject = 'paper:' || d.paper_sha256 AND instr(p.text, d.text) > 0);

DELETE FROM project_member_reads WHERE item_kind = 'dig' AND item_uuid IN (SELECT uuid FROM note_digs_left_over);
DELETE FROM digs WHERE uuid IN (SELECT uuid FROM note_digs_left_over);
DROP TABLE note_digs_left_over;
