-- Persist session labels so they survive session deletion.
-- The token-usage dashboard needs labels for past-day sessions that may have been deleted.

CREATE TABLE IF NOT EXISTS session_labels (
  agent_session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  label TEXT NOT NULL,
  PRIMARY KEY (agent_session_id, provider)
);

-- Backfill from existing sessions (captures labels before any future deletions)
INSERT OR IGNORE INTO session_labels (agent_session_id, provider, label)
  SELECT claude_session_id, 'claude', label FROM sessions
  WHERE claude_session_id IS NOT NULL AND label IS NOT NULL;

INSERT OR IGNORE INTO session_labels (agent_session_id, provider, label)
  SELECT copilot_session_id, 'copilot', label FROM sessions
  WHERE copilot_session_id IS NOT NULL AND label IS NOT NULL;

INSERT OR IGNORE INTO session_labels (agent_session_id, provider, label)
  SELECT gemini_session_id, 'gemini', label FROM sessions
  WHERE gemini_session_id IS NOT NULL AND label IS NOT NULL;
