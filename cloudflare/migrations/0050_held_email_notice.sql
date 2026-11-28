-- An email held for the day's or the week's (email_held) names the inbox
-- line written with it, where there is one. The job that sends what is
-- held (src/jobs/digests.ts) leaves out an email whose line was read
-- or is gone by then: its user has seen it in Papol.
ALTER TABLE email_held ADD COLUMN notification_uuid VARCHAR(36);
