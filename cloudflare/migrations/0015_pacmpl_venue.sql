-- A Proceedings of the ACM paper is known by the conference its issue
-- is: "Proceedings of the ACM on Programming Languages (ICFP)" is an
-- ICFP paper, and an issue numbered within its year ("OOPSLA2") is still
-- that conference (src/papers/extract.ts, paperVenue).

UPDATE papers
SET journal = CASE
  WHEN substr(journal, instr(journal, ' (') + 2, length(journal) - instr(journal, ' (') - 2) GLOB '*[A-Za-z][0-9]'
    THEN substr(journal, instr(journal, ' (') + 2, length(journal) - instr(journal, ' (') - 3)
  ELSE substr(journal, instr(journal, ' (') + 2, length(journal) - instr(journal, ' (') - 2)
END
WHERE journal LIKE 'Proceedings of the ACM on % (%)' AND instr(journal, ' (') > 0;
