import type { SessionStatus, SessionAttentionLevel } from '@shared/types';
import Tooltip from '../shared/Tooltip';

interface StatusBadgeProps {
  status: SessionStatus;
  attentionLevel: SessionAttentionLevel;
  attentionReason?: string | null;
  size?: 'sm' | 'md';
}

const statusColors: Record<SessionStatus, string> = {
  starting: 'bg-amber-400',
  active: 'bg-green-400',
  idle: 'bg-blue-400',
  waiting: 'bg-red-400',
  detached: 'bg-neutral-400',
  ended: 'bg-neutral-500',
};

const attentionRingColors: Record<string, string> = {
  action: 'ring-red-400/80 animate-pulse',
  info:   'ring-amber-400/80',
};

function buildTooltipContent(
  status: SessionStatus,
  attentionLevel: SessionAttentionLevel,
  attentionReason?: string | null,
): string {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  if (attentionReason) return `${label} — ${attentionReason}`;
  if (attentionLevel !== 'none') return `${label} (${attentionLevel} attention)`;
  return label;
}

function StatusBadge({
  status,
  attentionLevel,
  attentionReason,
  size = 'sm',
}: StatusBadgeProps): React.JSX.Element {
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  const ringClass =
    attentionLevel !== 'none'
      ? `ring-2 ${attentionRingColors[attentionLevel]}`
      : '';

  return (
    <Tooltip content={buildTooltipContent(status, attentionLevel, attentionReason)} side="right">
      <span
        className={`shrink-0 rounded-full ${dotSize} ${statusColors[status]} ${ringClass}`}
      />
    </Tooltip>
  );
}

export default StatusBadge;
