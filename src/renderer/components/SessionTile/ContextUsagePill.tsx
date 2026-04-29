import { useEffect } from 'react';
import { useSessionContextStore } from '../../stores/session-context-store';
import Tooltip from '../shared/Tooltip';

interface ContextUsagePillProps {
  claudeSessionId: string | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function colorFor(percent: number | null): string {
  if (percent == null) return 'bg-bg-primary text-text-muted';
  if (percent >= 90) return 'bg-red-400/20 text-red-300';
  if (percent >= 70) return 'bg-amber-400/20 text-amber-300';
  return 'bg-bg-primary text-text-muted';
}

function ContextUsagePill({ claudeSessionId }: ContextUsagePillProps): React.JSX.Element | null {
  const usage = useSessionContextStore((s) =>
    claudeSessionId ? s.byId[claudeSessionId] ?? null : null,
  );
  const fetch = useSessionContextStore((s) => s.fetch);

  // Re-fetch on mount and whenever claudeSessionId rotates (e.g. /clear).
  useEffect(() => {
    if (!claudeSessionId) return;
    void fetch(claudeSessionId);
  }, [claudeSessionId, fetch]);

  // Refetch on token-scan push events while mounted.
  useEffect(() => {
    if (!claudeSessionId) return;
    const unsub = window.mcode.tokens.onUpdated(() => {
      void fetch(claudeSessionId);
    });
    return unsub;
  }, [claudeSessionId, fetch]);

  if (!usage) return null;

  const { usedTokens, contextWindow, percent } = usage;
  const used = formatTokens(usedTokens);
  const limitText = contextWindow ? ` / ${formatTokens(contextWindow)}` : '';
  const pctText = percent != null ? ` · ${percent}%` : '';

  const tooltip = contextWindow
    ? `Context: ${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${percent}%)`
    : `Context: ${usedTokens.toLocaleString()} tokens — window unknown for ${usage.model}`;

  return (
    <Tooltip content={tooltip} side="bottom">
      <span
        className={`text-xs px-1.5 rounded ml-1 shrink-0 cursor-help ${colorFor(percent)}`}
      >
        {used}
        {limitText}
        {pctText}
      </span>
    </Tooltip>
  );
}

export default ContextUsagePill;
