-- Speed up the dock-badge COUNT(*) (attention_level = 'action') fired on every
-- session broadcast, plus the "any-attention" lookup in the renderer sync path.
CREATE INDEX IF NOT EXISTS idx_sessions_attention_level
  ON sessions(attention_level);
