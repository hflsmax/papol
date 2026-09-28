-- Where a dig stands, as anyone in its project moves it: still being dug,
-- stashed for later, gold worth keeping, or buried. Only an explicit move
-- changes it; only a dig still digging raises news.
ALTER TABLE digs ADD COLUMN phase VARCHAR(16) NOT NULL DEFAULT 'digging' CHECK (phase IN ('digging', 'stashed', 'gold', 'buried'));
