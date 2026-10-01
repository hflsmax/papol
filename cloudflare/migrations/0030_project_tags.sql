-- A project's shared vocabulary. These tags belong to the project, not to
-- the member who happened to make them, and stay when that member leaves.
-- Projects are online-only state, so these tables do not enter the personal
-- replica protocol used by tags and copy_tags.

CREATE TABLE project_tags (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	name VARCHAR(60) NOT NULL,
	normalized_name VARCHAR(60) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_tag_name UNIQUE (project_uuid, normalized_name),
	CONSTRAINT uq_project_tag_scope UNIQUE (project_uuid, uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid)
);
CREATE INDEX ix_project_tags_project_uuid ON project_tags (project_uuid);

-- SQLite requires an explicitly unique parent key for the composite
-- references below, even though each project-paper UUID is globally unique.
CREATE UNIQUE INDEX uq_project_paper_scope ON project_papers (project_uuid, uuid);

-- A shared tag on a shared paper. The project UUID is repeated deliberately:
-- routes can authorize and clean up the association without joining through
-- both parents, while the application verifies that all three rows belong to
-- the same project before writing it.
CREATE TABLE project_paper_tags (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	project_paper_uuid VARCHAR(36) NOT NULL,
	tag_uuid VARCHAR(36) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_paper_tag UNIQUE (project_paper_uuid, tag_uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(project_uuid, project_paper_uuid) REFERENCES project_papers (project_uuid, uuid),
	FOREIGN KEY(project_uuid, tag_uuid) REFERENCES project_tags (project_uuid, uuid)
);
CREATE INDEX ix_project_paper_tags_project_uuid ON project_paper_tags (project_uuid);
CREATE INDEX ix_project_paper_tags_project_paper_uuid ON project_paper_tags (project_paper_uuid);
CREATE INDEX ix_project_paper_tags_tag_uuid ON project_paper_tags (tag_uuid);
