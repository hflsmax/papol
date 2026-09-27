-- A project: where work on a question happens, by one person or several.
-- It holds papers, not copies: adding a paper to a project leaves every
-- member's copy where it is, and a paper can be in several projects and
-- on its members' shelves at once. Joining is by invitation, the code in
-- the link being the whole of the permission, as with a sharable.
--
-- Nothing here is synchronized: a project is read online, as the Library is.

CREATE TABLE projects (
	uuid VARCHAR(36) NOT NULL,
	name VARCHAR(80) NOT NULL,
	invite_code VARCHAR(10),
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (uuid)
);
CREATE UNIQUE INDEX ix_projects_invite_code ON projects (invite_code);

-- Who is in a project, and who keeps it. `seen_at` is when the member
-- last opened it: what others added after that is new to them.
CREATE TABLE project_members (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	user_uuid VARCHAR(36) NOT NULL,
	is_keeper BOOLEAN DEFAULT '0' NOT NULL,
	joined_at DATETIME NOT NULL,
	seen_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_member UNIQUE (project_uuid, user_uuid),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_project_members_project_uuid ON project_members (project_uuid);
CREATE INDEX ix_project_members_user_uuid ON project_members (user_uuid);

-- A paper in a project, and who added it. The paper is nobody's, so it
-- stays when the member who added it leaves.
CREATE TABLE project_papers (
	uuid VARCHAR(36) NOT NULL,
	project_uuid VARCHAR(36) NOT NULL,
	paper_sha256 VARCHAR(64) NOT NULL,
	added_by VARCHAR(36) NOT NULL,
	added_at DATETIME NOT NULL,
	PRIMARY KEY (uuid),
	CONSTRAINT uq_project_paper UNIQUE (project_uuid, paper_sha256),
	FOREIGN KEY(project_uuid) REFERENCES projects (uuid),
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
	FOREIGN KEY(added_by) REFERENCES users (uuid)
);
CREATE INDEX ix_project_papers_project_uuid ON project_papers (project_uuid);
CREATE INDEX ix_project_papers_paper_sha256 ON project_papers (paper_sha256);
CREATE INDEX ix_project_papers_added_by ON project_papers (added_by);
