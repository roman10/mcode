-- Rename is_claude_assisted → is_ai_assisted to reflect multi-CLI support.
ALTER TABLE commits RENAME COLUMN is_claude_assisted TO is_ai_assisted;
