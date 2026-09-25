-- A link made before short codes still has a UUID for its key, and asking
-- for a paper's link again hands that same UUID back: papol.io/s/<uuid>,
-- short in form only. Every such link gets a code of its own, which is what
-- is handed out from now on, and keeps its UUID beside it, which is what
-- anyone already holding the old link will follow.
--
-- A code is twelve characters of 0123456789abcdefghjkmnpqrstvwxyz, as the
-- Worker draws them (src/papers/sharables.ts): random() & 31 picks one of
-- the thirty-two with no bias, fresh for every character of every row. The
-- key refuses a repeat. At sixty bits there will not be one, and if there
-- were this migration would fail whole and could simply be run again.

ALTER TABLE sharables ADD COLUMN legacy_uuid VARCHAR(36);

CREATE UNIQUE INDEX ix_sharables_legacy_uuid ON sharables (legacy_uuid);

UPDATE sharables SET legacy_uuid = uuid WHERE length(uuid) = 36 AND legacy_uuid IS NULL;

UPDATE sharables SET uuid =
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1) ||
	substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (random() & 31), 1)
WHERE uuid = legacy_uuid;
