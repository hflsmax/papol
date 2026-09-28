-- Every paper's venue asked of the indexes again, once
-- (src/papers/venues.ts): venues read before a PACMPL issue counted as
-- the conference, and arXiv copies stored with none.

INSERT INTO jobs (uuid, kind, "key", payload, status, attempts, run_at, created_at)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
        'refresh_venues', NULL, '{}', 'queued', 0,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
