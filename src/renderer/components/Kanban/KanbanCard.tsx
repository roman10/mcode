import type { SessionInfo } from '@shared/types';
import { useAccountsStore } from '../../stores/accounts-store';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { splitLabelIcon } from '../../utils/label-utils';
import StatusBadge from '../Sidebar/StatusBadge';
import Tooltip from '../shared/Tooltip';

interface KanbanCardProps {
  session: SessionInfo;
  isSelected: boolean;
  onSelect(): void;
  onExpand(): void;
  onKill(): void;
  onDelete(): void;
}

const attentionBorderColors: Record<string, string> = {
  high: 'border-l-2 border-l-red-400',
  medium: 'border-l-2 border-l-amber-400',
  low: 'border-l-2 border-l-blue-400',
  none: '',
};

function KanbanCard({
  session,
  isSelected,
  onSelect,
  onExpand,
  onKill,
  onDelete,
}: KanbanCardProps): React.JSX.Element {
  const shortTime = useRelativeTime(session.startedAt);
  const [labelIcon, labelText] = splitLabelIcon(session.label);
  const attentionBorder = attentionBorderColors[session.attentionLevel] ?? '';
  const accountName = useAccountsStore((s) => {
    if (!session.accountId) return null;
    const account = s.accounts.find((a) => a.accountId === session.accountId);
    return account && !account.isDefault ? account.name : null;
  });

  return (
    <div
      className={`group rounded-md cursor-pointer transition-colors ${attentionBorder} ${
        isSelected
          ? 'bg-bg-elevated ring-1 ring-border-focus'
          : 'bg-bg-secondary hover:bg-bg-elevated'
      }`}
      onClick={onSelect}
      onDoubleClick={onExpand}
    >
      <div className="px-3 py-2.5">
        {/* Row 1: status dot + label + time */}
        <div className="flex items-center gap-2">
          <StatusBadge
            status={session.status}
            attentionLevel={session.attentionLevel}
            attentionReason={session.attentionReason}
          />
          <span className="flex-1 text-sm text-text-primary truncate" title={session.label}>
            {session.sessionType === 'terminal' && (
              <span className="text-text-muted font-mono text-xs mr-1">&gt;_</span>
            )}
            {labelIcon && <span className="mr-1">{labelIcon}</span>}
            {labelText}
            {accountName && (
              <span className="text-xs text-text-muted ml-1.5">{accountName}</span>
            )}
          </span>
          {shortTime && (
            <span className="text-xs text-text-muted shrink-0">{shortTime}</span>
          )}
        </div>

        {/* Row 2: cwd + last tool */}
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-xs text-text-muted truncate" title={session.cwd}>
            {session.cwd}
          </span>
          {session.lastTool && session.status !== 'ended' && (
            <Tooltip content={`Last tool: ${session.lastTool}`} side="top">
              <span className="text-xs text-text-muted bg-bg-primary px-1 rounded shrink-0">
                {session.lastTool}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Hover actions — collapsed until hover to save vertical space */}
      <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] focus-within:grid-rows-[1fr] transition-[grid-template-rows] duration-150">
      <div className="overflow-hidden flex items-center gap-1 px-3 pb-2">
        {session.status !== 'ended' ? (
          <Tooltip content="Kill session" side="top">
            <button
              className="text-xs text-text-secondary hover:text-red-400 px-1"
              onClick={(e) => {
                e.stopPropagation();
                onKill();
              }}
            >
              Kill
            </button>
          </Tooltip>
        ) : (
          <Tooltip content="Delete session" side="top">
            <button
              className="text-xs text-text-secondary hover:text-red-400 px-1"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              Delete
            </button>
          </Tooltip>
        )}
        <Tooltip content="Open terminal (Cmd+Enter)" side="top">
          <button
            className="text-xs text-text-secondary hover:text-text-primary px-1"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
          >
            Open
          </button>
        </Tooltip>
      </div>
      </div>
    </div>
  );
}

export default KanbanCard;
