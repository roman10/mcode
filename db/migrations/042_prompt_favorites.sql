-- Add pinning support for prompt history entries
ALTER TABLE human_input ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_human_input_pinned ON human_input(is_pinned) WHERE is_pinned = 1;
