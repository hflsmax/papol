-- Every link is named by a code of ten characters of digits and both
-- cases (src/papers/sharables.ts). Links named any other way — a UUID from
-- before short links, or twelve lower-case characters from their first
-- day — are dropped rather than renamed: whoever holds one is told it is
-- not shared, and sharing the paper again hands out a code.

DELETE FROM sharables WHERE length(uuid) <> 10;
