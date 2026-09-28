-- Seminars are gone: no calls, no cohorts, no leaders. Their rooms and
-- everything said and planned in them go, and so do the notifications
-- that pointed into a room. A notification no longer points anywhere, so
-- its table is rebuilt without the room column (SQLite cannot drop a
-- column that holds a foreign key).

PRAGMA defer_foreign_keys = true;

DELETE FROM notifications WHERE room_uuid IS NOT NULL;

CREATE TABLE notifications_new (
	uuid VARCHAR(36) NOT NULL, 
	user_uuid VARCHAR(36) NOT NULL, 
	content TEXT NOT NULL, 
	read BOOLEAN NOT NULL, 
	emailed BOOLEAN DEFAULT '0' NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (uuid), 
	FOREIGN KEY(user_uuid) REFERENCES users (uuid)
);
INSERT INTO notifications_new (uuid, user_uuid, content, read, emailed, created_at)
	SELECT uuid, user_uuid, content, read, emailed, created_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX ix_notifications_user_uuid ON notifications (user_uuid);

DROP TABLE room_availabilities;
DROP TABLE room_messages;
DROP TABLE room_participants;
DROP TABLE rooms;
