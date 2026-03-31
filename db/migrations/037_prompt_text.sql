-- Store the actual prompt text in human_input so users can search/reuse past prompts.
ALTER TABLE human_input ADD COLUMN prompt_text TEXT;

-- Reset scan watermarks so existing JSONL files are re-scanned to capture prompt text.
UPDATE tracked_jsonl_files SET last_scanned_offset = 0;
