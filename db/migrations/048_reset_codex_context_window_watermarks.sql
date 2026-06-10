-- Reparse Codex transcripts once so existing token_usage rows can backfill
-- context_window from token_count.info.model_context_window.
UPDATE tracked_jsonl_files
   SET last_scanned_offset = 0
 WHERE provider = 'codex';
