ALTER TABLE sessions ADD COLUMN command TEXT DEFAULT NULL;
ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_codex_thread_id
  ON sessions(codex_thread_id)
  WHERE codex_thread_id IS NOT NULL;
