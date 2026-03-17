import type { SessionStatus, SessionAttentionLevel } from '../../../shared/types';

interface StatusBadgeProps {
  status: SessionStatus;
  attentionLevel: SessionAttentionLevel;
  size?: 'sm' | 'md';
}

const statusColors: Record<SessionStatus, string> = {
  starting: 'bg-amber-400',
  active: 'bg-green-400',
  idle: 'bg-blue-400',
  waiting: 'bg-red-400',
  ended: 'bg-neutral-500',
};

const attentionRingColors: Record<string, string> = {
  high: 'ring-red-400/60 animate-pulse',
  medium: 'ring-amber-400/60',
  low: 'ring-blue-400/40',
};

function StatusBadge({
  status,
  attentionLevel,
  size = 'sm',
}: StatusBadgeProps): React.JSX.Element {
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  const ringClass =
    attentionLevel !== 'none'
      ? `ring-2 ${attentionRingColors[attentionLevel]}`
      : '';

  return (
    <span
      className={`shrink-0 rounded-full ${dotSize} ${statusColors[status]} ${ringClass}`}
      title={`${status}${attentionLevel !== 'none' ? ` (${attentionLevel} attention)` : ''}`}
    />
  );
}

export default StatusBadge;
