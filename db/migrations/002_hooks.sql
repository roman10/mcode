-- Hook integration and attention system columns
ALTER TABLE sessions ADD COLUMN claude_session_id TEXT;
ALTER TABLE sessions ADD COLUMN last_tool TEXT;
ALTER TABLE sessions ADD COLUMN last_event_at TEXT;
ALTER TABLE sessions ADD COLUMN attention_level TEXT NOT NULL DEFAULT 'none';
ALTER TABLE sessions ADD COLUMN attention_reason TEXT;
ALTER TABLE sessions ADD COLUMN hook_mode TEXT NOT NULL DEFAULT 'live';

-- Hook event log (append-only)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  claude_session_id TEXT,
  hook_event_name TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX idx_events_session ON events(session_id, created_at);
CREATE INDEX idx_events_type ON events(hook_event_name);
CREATE INDEX idx_sessions_claude_session_id ON sessions(claude_session_id);
