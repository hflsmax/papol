-- Activity is reading alone: the time spent on boards is no longer
-- recorded, and what was recorded of it goes. Every row left is of kind
-- 'reading', and its subject is a paper's sha256.

DELETE FROM activity WHERE kind <> 'reading';
