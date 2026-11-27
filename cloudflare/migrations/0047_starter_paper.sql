-- The paper a new user's nook starts with (routes/auth.ts): the setting
-- is put here unset, so that Admin's Database page shows the row to fill
-- in. Its value is a paper's name, as in its address, or its digest.
INSERT OR IGNORE INTO settings ("key", value) VALUES ('starter_paper', NULL);
