-- A mock user: an account made to try Papol out with, which nobody is
-- behind. It signs in and keeps papers as any account does, and to
-- everyone else it is not there: nobody finds it, is suggested it or can
-- ask it to be friends, it is nobody's friend, no paper names it as a
-- reader, its nook is its own alone, Papol sends it no email it could
-- have chosen, and the admin's counts leave it out.
--
-- Nothing of a mock user's is taken away for it. A friendship it was in
-- stays a row and counts for nothing, so an account marked by mistake is
-- whole again once the mark is taken off (an admin sets `is_mock` on the
-- row, in the users table of the admin page).
ALTER TABLE users ADD COLUMN is_mock BOOLEAN DEFAULT '0' NOT NULL;

-- Jane Doe, the account Papol has been tried out with.
UPDATE users SET is_mock = 1 WHERE uuid = '8f4d7586-554b-4862-b1bd-834bb25766a9' AND display_name = 'Jane Doe';
