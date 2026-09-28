-- Every paper's venue asked again (src/papers/venues.ts), now that a
-- conference paper is known by its conference's short name: "CHI", not
-- "Proceedings of the 2017 CHI Conference on Human Factors in Computing
-- Systems".

INSERT INTO jobs (uuid, kind, "key", payload, status, attempts, run_at, created_at)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
        'refresh_venues', NULL, '{}', 'queued', 0,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
