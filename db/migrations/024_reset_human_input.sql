-- Reset human input data after fixing overcounting (non-human messages were counted).
-- Also reset scan watermarks so all JSONL files are re-parsed with the fixed filter.
-- Token usage entries are safe: INSERT OR IGNORE deduplicates on re-scan.
DELETE FROM human_input;
UPDATE tracked_jsonl_files SET last_scanned_offset = 0;
