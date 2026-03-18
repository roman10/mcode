-- Commit tracking: stores git commits discovered across tracked repos

CREATE TABLE tracked_repos (
  repo_path TEXT PRIMARY KEY,
  last_scanned_at TEXT NOT NULL,
  last_head TEXT,
  author_email TEXT,
  discovered_from TEXT
);

CREATE TABLE commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  commit_message TEXT,
  commit_type TEXT,
  author_name TEXT,
  author_email TEXT,
  is_claude_assisted INTEGER NOT NULL DEFAULT 0,
  committed_at TEXT NOT NULL,
  date TEXT NOT NULL,
  files_changed INTEGER,
  insertions INTEGER,
  deletions INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo_path, commit_hash)
);

CREATE INDEX idx_commits_date ON commits(date);
CREATE INDEX idx_commits_repo_date ON commits(repo_path, date);
CREATE INDEX idx_commits_author ON commits(author_email, date);
