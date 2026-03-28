ALTER TABLE sessions ADD COLUMN gemini_session_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_gemini_session_id
  ON sessions(gemini_session_id)
  WHERE gemini_session_id IS NOT NULL;