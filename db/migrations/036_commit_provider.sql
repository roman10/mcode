-- Add detected_provider to commits for per-CLI filtering.
-- NULL means non-AI or unknown; 'claude'/'codex'/'copilot'/'gemini' for AI-assisted.
ALTER TABLE commits ADD COLUMN detected_provider TEXT;

CREATE INDEX IF NOT EXISTS idx_commits_provider_date ON commits(detected_provider, date);
