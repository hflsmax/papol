-- Reactions: an emoji a user sets on something said, in the Lounge or in
-- a dig. A reaction is a reply of a special sort, kept where replies are:
-- in a thread it is a row of thread_replies, in a dig a row of dig_posts,
-- with its emoji named (and repeated as its words, which a row must
-- have). So it is seen by exactly who sees the thread or the dig, and
-- goes when they go, by the rules replies and posts already follow.
--
-- It is on the thread or the dig itself, or on one reply or post in it,
-- which it then names. A user sets each emoji once on each thing. Every
-- reader of what was said leaves these rows out (emoji IS NULL): a
-- reaction is drawn under what it is on, and is counted as nothing said.
ALTER TABLE thread_replies ADD COLUMN emoji VARCHAR(32);
ALTER TABLE thread_replies ADD COLUMN on_reply_uuid VARCHAR(36);
CREATE UNIQUE INDEX ux_thread_replies_reaction ON thread_replies (thread_uuid, coalesce(on_reply_uuid, ''), user_uuid, emoji) WHERE emoji IS NOT NULL;
CREATE INDEX ix_thread_replies_on_reply_uuid ON thread_replies (on_reply_uuid) WHERE on_reply_uuid IS NOT NULL;

ALTER TABLE dig_posts ADD COLUMN emoji VARCHAR(32);
ALTER TABLE dig_posts ADD COLUMN on_post_uuid VARCHAR(36);
CREATE UNIQUE INDEX ux_dig_posts_reaction ON dig_posts (dig_uuid, coalesce(on_post_uuid, ''), user_uuid, emoji) WHERE emoji IS NOT NULL;
CREATE INDEX ix_dig_posts_on_post_uuid ON dig_posts (on_post_uuid) WHERE on_post_uuid IS NOT NULL;
