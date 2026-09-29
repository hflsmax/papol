-- What the viewer's nav bar marks for this reader, as a JSON list of kinds
-- (config/nav_marks.json); NULL is the default set.
ALTER TABLE users ADD COLUMN nav_marks TEXT;
