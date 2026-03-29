ALTER TABLE sessions ADD COLUMN copilot_session_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_copilot_session_id
  ON sessions(copilot_session_id)
  WHERE copilot_session_id IS NOT NULL;
