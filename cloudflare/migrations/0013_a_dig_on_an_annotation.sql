-- A dig can be about one annotation: a note, a stroke of ink or a clip a
-- member left on one of the project's papers, which the viewer shows to
-- every member once it is opened with the project on. The annotation stays
-- its author's; the dig is the project's, keyed "annotation:<uuid>".

ALTER TABLE discussions ADD COLUMN annotation_uuid VARCHAR(36) REFERENCES annotations (uuid);
CREATE INDEX ix_discussions_annotation_uuid ON discussions (annotation_uuid);
