-- Human input tracking from Claude Code JSONL session files
CREATE TABLE IF NOT EXISTS human_input (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  claude_session_id TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  text_length INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  message_timestamp TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_human_input_session ON human_input(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_human_input_date ON human_input(date);
