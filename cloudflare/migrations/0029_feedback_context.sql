-- Where a report's writer was and what they had just done, as the JSON the
-- client sends (shared/feedbackTrail.js): app, runtime, version, page,
-- title, project, viewport, browser, system, language, online, and a trail
-- of the last pages opened, controls pressed and errors raised.
ALTER TABLE feedback ADD COLUMN context TEXT;
