-- Core session tracking
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  label TEXT,
  cwd TEXT NOT NULL,
  permission_mode TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Layout persistence
CREATE TABLE layout_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mosaic_tree TEXT NOT NULL,
  sidebar_width INTEGER DEFAULT 280,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User preferences
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
