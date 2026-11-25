-- A keeper answers an ask to join: Accept lets the asker in and the ask is
-- spent; Not now is quiet, as with a friend request. The asker is never
-- told and the ask stands, so asking again says nothing new.
ALTER TABLE project_asks ADD COLUMN declined_at DATETIME;
