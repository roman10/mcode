-- Store the provider-reported context window per token_usage row.
--
-- Codex emits `model_context_window` in every `token_count` transcript event
-- (plan- and model-dependent, e.g. 258400). Persisting it lets the context
-- badge show "X / Y · Z%" for Codex sessions without a hardcoded per-model
-- table. Claude/Gemini/Copilot rows leave this NULL and fall back to the
-- getContextWindow() lookup (Claude) or hide the limit (others).

ALTER TABLE token_usage ADD COLUMN context_window INTEGER;
