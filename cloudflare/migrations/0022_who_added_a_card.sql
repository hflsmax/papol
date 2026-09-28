-- Who put a card on its board. A project's board is edited by all its
-- members, so a card someone else added there is news to the rest, as a
-- paper someone else added is. Kept on the service alone; a replica has
-- no use for it. Cards already made are taken as their board's owner's.
ALTER TABLE board_items ADD COLUMN added_by VARCHAR(36) REFERENCES users (uuid);
UPDATE board_items SET added_by = (SELECT user_uuid FROM boards WHERE boards.uuid = board_items.board_uuid);
CREATE INDEX ix_board_items_added_by ON board_items (added_by);
