-- Each public field of a copy says for itself whether it is shown.
--
-- Visibility used to live on the shelf and nowhere else: thought and
-- ratings were public, summary and tags private, and the shelf decided
-- whether any of it was seen. The shelf still decides whether the copy is
-- on display at all; within a copy on display, each of these four now
-- answers for itself. The defaults are what every copy was before.

ALTER TABLE copies ADD COLUMN thought_public BOOLEAN DEFAULT '1' NOT NULL;
ALTER TABLE copies ADD COLUMN ratings_public BOOLEAN DEFAULT '1' NOT NULL;
ALTER TABLE copies ADD COLUMN summary_public BOOLEAN DEFAULT '0' NOT NULL;
ALTER TABLE copies ADD COLUMN tags_public BOOLEAN DEFAULT '0' NOT NULL;

UPDATE settings SET value = '4' WHERE "key" = 'schema_version';
