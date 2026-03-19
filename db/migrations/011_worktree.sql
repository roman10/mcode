-- Add worktree column to sessions for Claude Code --worktree flag support

ALTER TABLE sessions ADD COLUMN worktree TEXT DEFAULT NULL;
