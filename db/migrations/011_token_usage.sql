-- Token usage tracking from Claude Code JSONL session files
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  claude_session_id TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  is_fast_mode INTEGER NOT NULL DEFAULT 0,
  message_timestamp TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_token_usage_session ON token_usage(claude_session_id);
CREATE INDEX idx_token_usage_date ON token_usage(date);
CREATE INDEX idx_token_usage_model_date ON token_usage(model, date);

-- Byte offset watermark for incremental JSONL parsing
CREATE TABLE tracked_jsonl_files (
  file_path TEXT PRIMARY KEY,
  claude_session_id TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  last_scanned_offset INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT NOT NULL
);
