-- Multi-provider stats: rename claude_session_id → agent_session_id,
-- add provider column for multi-CLI tracking, add premium_requests for
-- subscription-based CLIs (e.g. Copilot).

ALTER TABLE token_usage RENAME COLUMN claude_session_id TO agent_session_id;
ALTER TABLE human_input RENAME COLUMN claude_session_id TO agent_session_id;
ALTER TABLE tracked_jsonl_files RENAME COLUMN claude_session_id TO agent_session_id;

ALTER TABLE token_usage ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE human_input ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE tracked_jsonl_files ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';

ALTER TABLE token_usage ADD COLUMN premium_requests INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_token_usage_provider_date ON token_usage(provider, date);
CREATE INDEX IF NOT EXISTS idx_human_input_provider_date ON human_input(provider, date);
