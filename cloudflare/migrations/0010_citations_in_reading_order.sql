-- A citation's place in the analyzer's reading of the paper: down one
-- column, then the next. The analyzer finds markers in that order, and the
-- viewer steps through the places a work is cited in it. Sorting by where a
-- marker sits on its page cannot recover it — on a two-column page the top
-- of the right column is above the foot of the left.
--
-- Rows already read have none, and keep being served in page order; a
-- paper read again gets its ordinals.

ALTER TABLE paper_citations ADD COLUMN ordinal INTEGER;
