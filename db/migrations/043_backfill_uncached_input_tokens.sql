-- Backfill uncached input_tokens for Copilot, Codex, Gemini rows.
--
-- Prior to commit 2fe2598, the parsers for these three providers stored the
-- raw API-reported prompt total into `input_tokens`. That total includes
-- cache reads and (for Copilot) cache writes. The app-wide convention —
-- established by the Claude Code parser against the Anthropic API — is that
-- `input_tokens` holds the uncached slice only, with cached tokens tracked
-- separately in `cache_read_tokens` and `cache_write_*_tokens`.
--
-- The mismatch caused three user-visible bugs:
--   * `In:` totals in the Stats panel were inflated — cached reads were
--     counted once in `input_tokens` and again in `cache_read_tokens`.
--   * The `(N uncached)` annotation printed the full input figure.
--   * Cost estimates over-billed cached tokens at full input rate plus the
--     10% cache-read rate.
--
-- This migration retroactively fixes existing rows so historical Stats match
-- reality. The parser fix in 2fe2598 ensures new rows are stored correctly.
--
-- Safety:
--   * Migrations run exactly once per database (tracked in schema_version),
--     and run during getDb() initialization before any scanner executes. So
--     when this statement runs, every row in `token_usage` for these three
--     providers was written under the old (inclusive) semantic.
--   * MAX(0, ...) guards against any unusual fixture where the subtraction
--     would underflow. Clamping to 0 is safer than letting the column go
--     negative; the overwhelming majority of affected rows have
--     input_tokens > cache_read + cache_write_1h by construction.
--   * Only touches rows for providers that had the bug. Claude rows are
--     untouched because the Claude parser was always correct.

UPDATE token_usage
  SET input_tokens = MAX(0, input_tokens - cache_read_tokens - cache_write_1h_tokens)
  WHERE provider IN ('copilot', 'codex', 'gemini');
