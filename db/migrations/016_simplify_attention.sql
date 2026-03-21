-- Simplify attention levels from 4 (none/low/medium/high) to 3 (none/info/action).
-- 'high' → 'action' (requires user input)
-- 'medium' → 'info' (informational, no action required)
-- 'low' → 'none' (turn-complete indicator — no longer surfaced as attention)
UPDATE sessions SET attention_level = 'action' WHERE attention_level = 'high';
UPDATE sessions SET attention_level = 'info'   WHERE attention_level = 'medium';
UPDATE sessions SET attention_level = 'none'   WHERE attention_level = 'low';
