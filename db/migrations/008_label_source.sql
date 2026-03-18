-- Track whether a session label was set automatically (e.g. from terminal title)
-- or manually by the user, so auto-updates don't overwrite user renames.
ALTER TABLE sessions ADD COLUMN label_source TEXT NOT NULL DEFAULT 'auto';
