import { useSessionStore } from '../../stores/session-store';
import type { SessionStatus } from '../../../shared/types';

interface TerminalToolbarProps {
  sessionId: string;
  onClose(): void;
}

const statusLabels: Record<SessionStatus, string> = {
  starting: 'Starting',
  active: 'Active',
  idle: 'Idle',
  waiting: 'Waiting',
  ended: 'Ended',
};

const statusColors: Record<SessionStatus, string> = {
  starting: 'text-amber-400',
  active: 'text-green-400',
  idle: 'text-blue-400',
  waiting: 'text-red-400',
  ended: 'text-neutral-500',
};

function TerminalToolbar({
  sessionId,
  onClose,
}: TerminalToolbarProps): React.JSX.Element {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const label = session?.label ?? 'Unknown';
  const status = session?.status ?? 'ended';
  const attentionLevel = session?.attentionLevel ?? 'none';
  const lastTool = session?.lastTool;

  const handleKill = async (): Promise<void> => {
    try {
      await window.mcode.sessions.kill(sessionId);
    } catch (err) {
      console.error('Failed to kill session:', err);
    }
  };

  const highAttentionGlow =
    attentionLevel === 'high'
      ? 'shadow-[inset_0_-1px_0_0_rgba(248,113,113,0.5)]'
      : '';

  return (
    <div
      className={`flex items-center h-8 px-3 bg-bg-secondary border-b border-border-default shrink-0 [-webkit-app-region:no-drag] ${highAttentionGlow}`}
    >
      {/* Status + label */}
      <span className={`text-xs mr-1.5 ${statusColors[status]}`}>
        {statusLabels[status]}
      </span>
      {lastTool && status !== 'ended' && (
        <span className="text-xs text-text-muted mr-1.5">
          {lastTool}
        </span>
      )}
      <span className="text-xs text-text-primary truncate flex-1" title={label}>
        {label}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 ml-2">
        {status !== 'ended' && (
          <button
            className="text-text-muted hover:text-red-400 text-xs px-1 transition-colors"
            title="Kill session"
            onClick={handleKill}
          >
            Kill
          </button>
        )}
        <button
          className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
          title="Close tile (session keeps running)"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default TerminalToolbar;
