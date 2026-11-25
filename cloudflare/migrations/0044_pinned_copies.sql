-- A copy its user pinned leads their nook.
--
-- Pinning is the user's own say about their copy, like its shelf: it is
-- kept on the copy and synchronized with it, so a paper pinned on the
-- website leads the nook in Papol for Mac, and one pinned on a Mac that
-- is offline is pinned everywhere once it syncs. Nobody else is shown it:
-- a visitor reads a nook in its own order.
--
-- A change to a synchronized table's shape, so the schema version moves:
-- a replica written under the old one is pulled again, and a build made
-- for the old one is told to update.

ALTER TABLE copies ADD COLUMN pinned BOOLEAN DEFAULT '0' NOT NULL;

UPDATE settings SET value = '6' WHERE "key" = 'schema_version';
