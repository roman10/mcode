-- Remove progress-message-derived rows (redundant with subagent file data).
-- No watermark reset needed: subagent files have no watermarks and will be
-- fully scanned on next scanAll(); main session watermarks stay intact.
DELETE FROM token_usage WHERE message_id LIKE 'msg_%';
