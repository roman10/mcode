-- Track how detected_provider was determined.
-- 'trailer' = from Co-Authored-By trailer, 'session' = from active session overlap.
ALTER TABLE commits ADD COLUMN attribution_source TEXT;

-- Backfill existing attributed commits as trailer-based.
UPDATE commits SET attribution_source = 'trailer' WHERE detected_provider IS NOT NULL;
