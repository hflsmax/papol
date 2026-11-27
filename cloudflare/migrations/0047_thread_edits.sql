-- What is said in a thread can be reworded by whoever said it: the
-- starter's own words, and each reply. When it last was is kept beside
-- it, as a dig and a post keep theirs. Rewording is not news: a thread's
-- place in the Lounge goes by when things were first said.
ALTER TABLE threads ADD COLUMN edited_at DATETIME;
ALTER TABLE thread_replies ADD COLUMN edited_at DATETIME;
