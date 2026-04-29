-- Track the timestamp of the latest /compact summary observed in each
-- session's transcript. Used by getSessionUsage() to suppress the context
-- badge between a manual /compact and the next assistant turn — without
-- this, the badge would briefly show the pre-compact value because the
-- transcript still has the old high-input assistant message as its tail.

ALTER TABLE sessions ADD COLUMN last_compact_at TEXT;
