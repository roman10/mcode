CREATE TABLE task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  target_session_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  dispatched_at TEXT,
  completed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_task_queue_status ON task_queue(status, priority DESC, created_at);
CREATE INDEX idx_task_queue_session ON task_queue(session_id)
  WHERE status = 'dispatched';
CREATE INDEX idx_task_queue_target ON task_queue(target_session_id, status, priority DESC, created_at)
  WHERE target_session_id IS NOT NULL;
