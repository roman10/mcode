-- Reset watermarks for Gemini .jsonl transcripts that were marked "scanned"
-- before the parser supported the new format. Without this, scanFile()
-- short-circuits on `fileSize <= last_scanned_offset` and the four orphaned
-- transcripts (Apr 24-27 in affected installs) never get re-read.
--
-- Re-deletion on later runs is a no-op; the scanner re-creates these rows
-- with correct session ids on the next scan pass.

DELETE FROM tracked_jsonl_files
  WHERE provider = 'gemini' AND file_path LIKE '%.jsonl';
