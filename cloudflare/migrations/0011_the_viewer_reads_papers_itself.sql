-- The viewer reads a paper's references, citations, figures and links
-- itself, in the browser, and the host's analyzer that read them for the
-- server is gone. What it stored goes with it: the markers, the floats,
-- the links and the paper's record of a pass. The references stay, as the
-- cache of what each printed reference was looked up as; where one was
-- printed on the page was the analyzer's, and goes.

DROP TABLE paper_citation_works;
DROP TABLE paper_citations;
DROP TABLE paper_links;
DROP TABLE paper_floats;

ALTER TABLE papers DROP COLUMN references_status;
ALTER TABLE papers DROP COLUMN references_error;
ALTER TABLE papers DROP COLUMN references_at;

ALTER TABLE paper_references DROP COLUMN page;
ALTER TABLE paper_references DROP COLUMN y;

DELETE FROM jobs WHERE kind = 'analyze_paper';
