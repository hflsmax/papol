-- Every paper's venue asked again (src/papers/venues.ts). Migrations
-- apply before the Worker that knows the new rules is deployed, and the
-- sweep may claim a job in between: 0020's could run on the old code. This
-- one waits ten minutes, past the deploy.

INSERT INTO jobs (uuid, kind, "key", payload, status, attempts, run_at, created_at)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
        'refresh_venues', NULL, '{}', 'queued', 0,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
