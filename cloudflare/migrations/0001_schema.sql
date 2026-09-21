-- The schema backend/models.py declares, as SQLite. Generated from the
-- models by SQLAlchemy's SQLite dialect and kept verbatim, so the two
-- backends agree on every column while both exist. The version stamp at
-- the end is what backend/database.py writes on first start.

CREATE TABLE error_logs (
	uuid VARCHAR(36) NOT NULL, 
	method VARCHAR, 
	path TEXT, 
	message TEXT NOT NULL, 
	traceback TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (uuid)
);

CREATE TABLE settings (
	"key" VARCHAR NOT NULL, 
	value TEXT, 
	PRIMARY KEY ("key")
);

CREATE TABLE users (
	uuid VARCHAR(36) NOT NULL, 
	email VARCHAR NOT NULL, 
	display_name VARCHAR NOT NULL, 
	affiliation VARCHAR, 
	avatar_path VARCHAR, 
	email_public BOOLEAN DEFAULT '1' NOT NULL, 
	is_admin BOOLEAN DEFAULT '0' NOT NULL, 
	password_hash VARCHAR NOT NULL, 
	created_at DATETIME, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid)
);
CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE _server_change_log (
	sequence INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 
	user_uuid VARCHAR(36) NOT NULL, 
	table_name VARCHAR(64) NOT NULL, 
	row_uuid VARCHAR(36) NOT NULL, 
	revision INTEGER NOT NULL, 
	operation VARCHAR(10) NOT NULL, 
	row_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix__server_change_log_user_uuid ON _server_change_log (user_uuid);

CREATE TABLE _server_clients (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	client_uuid VARCHAR(36) NOT NULL, 
	acknowledged_cursor INTEGER DEFAULT '0' NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	app_version VARCHAR(32), 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_server_sync_client UNIQUE (user_uuid, client_uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix__server_clients_user_uuid ON _server_clients (user_uuid);

CREATE TABLE admin_messages (
	uuid VARCHAR(36) NOT NULL, 
	created_by_uuid VARCHAR(36) NOT NULL, 
	content TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(created_by_uuid) REFERENCES users (uuid)
);

CREATE TABLE applied_mutations (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	client_uuid VARCHAR(36) NOT NULL, 
	mutation_uuid VARCHAR(36) NOT NULL, 
	request_hash VARCHAR(64) NOT NULL, 
	method VARCHAR(8) NOT NULL, 
	path TEXT NOT NULL, 
	response_status INTEGER NOT NULL, 
	response_content_type VARCHAR(255), 
	response_body BLOB NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_applied_mutation_identity UNIQUE (user_uuid, client_uuid, mutation_uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_applied_mutations_user_uuid ON applied_mutations (user_uuid);

CREATE TABLE auth_tokens (
	token VARCHAR NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	created_at DATETIME, 
	last_used_at DATETIME, 
	platform VARCHAR, 
	revoked_at DATETIME, 
	PRIMARY KEY (token), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);

CREATE TABLE feedback (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36), 
	content TEXT NOT NULL, 
	page TEXT, 
	contact VARCHAR, 
	resolved BOOLEAN DEFAULT '0' NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_feedback_user_uuid ON feedback (user_uuid);

CREATE TABLE jobs (
	uuid VARCHAR(36) NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	"key" VARCHAR(120), 
	payload TEXT NOT NULL, 
	status VARCHAR(10) NOT NULL, 
	user_uuid VARCHAR(36), 
	result TEXT, 
	error TEXT, 
	attempts INTEGER DEFAULT '0' NOT NULL, 
	run_at DATETIME NOT NULL, 
	created_at DATETIME, 
	started_at DATETIME, 
	finished_at DATETIME, 
	worker VARCHAR(120), 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_jobs_user_uuid ON jobs (user_uuid);
CREATE UNIQUE INDEX uq_jobs_live_key ON jobs ("key") WHERE status IN ('queued', 'running');
CREATE INDEX ix_jobs_due ON jobs (status, run_at);

CREATE TABLE papers (
	sha256 VARCHAR(64) NOT NULL, 
	doi TEXT, 
	title TEXT NOT NULL, 
	authors TEXT, 
	journal TEXT, 
	year INTEGER, 
	file_path TEXT NOT NULL, 
	uploaded_by VARCHAR(36), 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '1' NOT NULL, 
	deleted_at DATETIME, 
	references_status VARCHAR, 
	references_error TEXT, 
	references_at DATETIME, 
	PRIMARY KEY (sha256), 
	FOREIGN KEY(uploaded_by) REFERENCES users (uuid)
);

CREATE TABLE shelves (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	name VARCHAR(40) NOT NULL, 
	color VARCHAR(7) NOT NULL, 
	is_public BOOLEAN DEFAULT '0' NOT NULL, 
	is_default BOOLEAN DEFAULT '0' NOT NULL, 
	position INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_shelf_user_name UNIQUE (user_uuid, name), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_shelves_user_uuid ON shelves (user_uuid);

CREATE TABLE tags (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	name VARCHAR(60) NOT NULL, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_tag_user_name UNIQUE (user_uuid, name), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_tags_user_uuid ON tags (user_uuid);

CREATE TABLE admin_message_deliveries (
	uuid VARCHAR(36) NOT NULL, 
	message_uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	dismissed_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_admin_message_delivery UNIQUE (message_uuid, user_uuid), 
	FOREIGN KEY(message_uuid) REFERENCES admin_messages (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_admin_message_deliveries_message_uuid ON admin_message_deliveries (message_uuid);
CREATE INDEX ix_admin_message_deliveries_user_uuid ON admin_message_deliveries (user_uuid);

CREATE TABLE annotations (
	uuid VARCHAR(36) NOT NULL, 
	kind VARCHAR(8) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	paper_sha256 VARCHAR(64) NOT NULL, 
	page INTEGER, 
	group_uuid VARCHAR(36), 
	content TEXT NOT NULL, 
	name VARCHAR, 
	body TEXT DEFAULT '{}' NOT NULL, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_annotations_kind ON annotations (kind);
CREATE INDEX ix_annotations_paper_sha256 ON annotations (paper_sha256);
CREATE INDEX ix_annotations_user_uuid ON annotations (user_uuid);
CREATE INDEX ix_annotations_page ON annotations (page);

CREATE TABLE boards (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	shelf_uuid VARCHAR(36), 
	name VARCHAR(120) NOT NULL, 
	description TEXT, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid), 
	FOREIGN KEY(shelf_uuid) REFERENCES shelves (uuid)
);
CREATE INDEX ix_boards_user_uuid ON boards (user_uuid);
CREATE INDEX ix_boards_shelf_uuid ON boards (shelf_uuid);

CREATE TABLE copies (
	uuid VARCHAR(36) NOT NULL, 
	paper_sha256 VARCHAR(64) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	shelf_uuid VARCHAR(36), 
	summary TEXT, 
	thought TEXT, 
	is_author BOOLEAN DEFAULT '0' NOT NULL, 
	rating_expertise INTEGER, 
	rating_reading INTEGER, 
	rating_liking INTEGER, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_copy UNIQUE (paper_sha256, user_uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid), 
	FOREIGN KEY(shelf_uuid) REFERENCES shelves (uuid)
);
CREATE INDEX ix_copies_shelf_uuid ON copies (shelf_uuid);
CREATE INDEX ix_copies_paper_sha256 ON copies (paper_sha256);
CREATE INDEX ix_copies_user_uuid ON copies (user_uuid);

CREATE TABLE paper_links (
	uuid VARCHAR(36) NOT NULL, 
	paper_sha256 VARCHAR(64) NOT NULL, 
	kind VARCHAR NOT NULL, 
	label TEXT, 
	page INTEGER NOT NULL, 
	x FLOAT NOT NULL, 
	y FLOAT NOT NULL, 
	w FLOAT NOT NULL, 
	h FLOAT NOT NULL, 
	target_page INTEGER NOT NULL, 
	target_y FLOAT NOT NULL, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_paper_links_page ON paper_links (page);
CREATE INDEX ix_paper_links_paper_sha256 ON paper_links (paper_sha256);

CREATE TABLE paper_references (
	uuid VARCHAR(36) NOT NULL, 
	paper_sha256 VARCHAR(64) NOT NULL, 
	"key" VARCHAR NOT NULL, 
	"index" INTEGER NOT NULL, 
	raw TEXT, 
	title TEXT, 
	authors TEXT, 
	year INTEGER, 
	journal TEXT, 
	doi TEXT, 
	arxiv_id TEXT, 
	page INTEGER, 
	y FLOAT, 
	resolved_status VARCHAR, 
	resolved_at DATETIME, 
	resolution TEXT, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_paper_references_paper_sha256 ON paper_references (paper_sha256);

CREATE TABLE rooms (
	uuid VARCHAR(36) NOT NULL, 
	paper_sha256 VARCHAR(64) NOT NULL, 
	created_by VARCHAR(36) NOT NULL, 
	leader_uuid VARCHAR(36), 
	status VARCHAR NOT NULL, 
	scheduled_time TEXT, 
	platform TEXT, 
	style VARCHAR, 
	style_desc TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256), 
	FOREIGN KEY(created_by) REFERENCES users (uuid), 
	FOREIGN KEY(leader_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_rooms_paper_sha256 ON rooms (paper_sha256);

CREATE TABLE sharables (
	uuid VARCHAR(36) NOT NULL, 
	kind VARCHAR(8) DEFAULT 'lean' NOT NULL, 
	user_uuid VARCHAR(36), 
	paper_sha256 VARCHAR(64) NOT NULL, 
	created_at DATETIME NOT NULL, 
	revoked_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)
);
CREATE INDEX ix_sharables_paper_sha256 ON sharables (paper_sha256);
CREATE INDEX ix_sharables_user_uuid ON sharables (user_uuid);

CREATE TABLE board_groups (
	uuid VARCHAR(36) NOT NULL, 
	board_uuid VARCHAR(36) NOT NULL, 
	kind VARCHAR(20) DEFAULT 'booklet' NOT NULL, 
	title VARCHAR(240) NOT NULL, 
	header TEXT, 
	auto_arrange BOOLEAN DEFAULT '0' NOT NULL, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(board_uuid) REFERENCES boards (uuid)
);
CREATE INDEX ix_board_groups_board_uuid ON board_groups (board_uuid);

CREATE TABLE copy_tags (
	uuid VARCHAR(36) NOT NULL, 
	copy_uuid VARCHAR(36) NOT NULL, 
	tag_uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_copy_tag UNIQUE (copy_uuid, tag_uuid), 
	FOREIGN KEY(copy_uuid) REFERENCES copies (uuid), 
	FOREIGN KEY(tag_uuid) REFERENCES tags (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_copy_tags_tag_uuid ON copy_tags (tag_uuid);
CREATE INDEX ix_copy_tags_user_uuid ON copy_tags (user_uuid);
CREATE INDEX ix_copy_tags_copy_uuid ON copy_tags (copy_uuid);

CREATE TABLE notifications (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	room_uuid VARCHAR(36), 
	content TEXT NOT NULL, 
	read BOOLEAN NOT NULL, 
	emailed BOOLEAN DEFAULT '0' NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid), 
	FOREIGN KEY(room_uuid) REFERENCES rooms (uuid)
);
CREATE INDEX ix_notifications_user_uuid ON notifications (user_uuid);

CREATE TABLE paper_citations (
	uuid VARCHAR(36) NOT NULL, 
	paper_sha256 VARCHAR(64) NOT NULL, 
	reference_uuid VARCHAR(36), 
	label TEXT, 
	page INTEGER NOT NULL, 
	x FLOAT NOT NULL, 
	y FLOAT NOT NULL, 
	w FLOAT NOT NULL, 
	h FLOAT NOT NULL, 
	inferred BOOLEAN, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(paper_sha256) REFERENCES papers (sha256), 
	FOREIGN KEY(reference_uuid) REFERENCES paper_references (uuid)
);
CREATE INDEX ix_paper_citations_paper_sha256 ON paper_citations (paper_sha256);
CREATE INDEX ix_paper_citations_page ON paper_citations (page);

CREATE TABLE room_availabilities (
	uuid VARCHAR(36) NOT NULL, 
	room_uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	availability TEXT NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_room_availability UNIQUE (room_uuid, user_uuid), 
	FOREIGN KEY(room_uuid) REFERENCES rooms (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_room_availabilities_room_uuid ON room_availabilities (room_uuid);

CREATE TABLE room_messages (
	uuid VARCHAR(36) NOT NULL, 
	room_uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	content TEXT NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(room_uuid) REFERENCES rooms (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_room_messages_room_uuid ON room_messages (room_uuid);

CREATE TABLE room_participants (
	uuid VARCHAR(36) NOT NULL, 
	room_uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	CONSTRAINT uq_room_participant UNIQUE (room_uuid, user_uuid), 
	FOREIGN KEY(room_uuid) REFERENCES rooms (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
CREATE INDEX ix_room_participants_room_uuid ON room_participants (room_uuid);

CREATE TABLE board_items (
	uuid VARCHAR(36) NOT NULL, 
	board_uuid VARCHAR(36) NOT NULL, 
	group_uuid VARCHAR(36), 
	kind VARCHAR(20) NOT NULL, 
	content TEXT, 
	excerpt_text TEXT, 
	file_path TEXT, 
	sha256 VARCHAR(64), 
	original_filename TEXT, 
	mime_type VARCHAR(255), 
	source_url TEXT, 
	source_label TEXT, 
	staged BOOLEAN DEFAULT '0' NOT NULL, 
	text_align VARCHAR(10) DEFAULT 'left' NOT NULL, 
	position INTEGER DEFAULT '0' NOT NULL, 
	x FLOAT DEFAULT '0' NOT NULL, 
	y FLOAT DEFAULT '0' NOT NULL, 
	width FLOAT DEFAULT '300' NOT NULL, 
	deleted_at DATETIME, 
	created_at DATETIME, 
	updated_at DATETIME, 
	revision INTEGER DEFAULT '0' NOT NULL, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(board_uuid) REFERENCES boards (uuid), 
	FOREIGN KEY(group_uuid) REFERENCES board_groups (uuid)
);
CREATE INDEX ix_board_items_board_uuid ON board_items (board_uuid);
CREATE INDEX ix_board_items_group_uuid ON board_items (group_uuid);

INSERT INTO settings ("key", value) VALUES ('schema_version', '3');
