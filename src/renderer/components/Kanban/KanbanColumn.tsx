import type { KanbanColumnDef } from './kanban-utils';
import KanbanCard from './KanbanCard';

interface KanbanColumnProps {
  column: KanbanColumnDef;
  sessionIds: string[];
  shortTimesBySessionId: Record<string, string>;
  selectedSessionId: string | null;
  onSelectSession(sessionId: string): void;
  onExpandSession(sessionId: string): void;
  onKillSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
  onClearAll?(): void;
}

function KanbanColumn({
  column,
  sessionIds,
  shortTimesBySessionId,
  selectedSessionId,
  onSelectSession,
  onExpandSession,
  onKillSession,
  onDeleteSession,
  onClearAll,
}: KanbanColumnProps): React.JSX.Element {
  return (
    <div className="flex flex-col min-w-[200px] flex-1">
      {/* Column header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-t-2 ${column.accentColor} bg-bg-secondary rounded-t-md`}>
        <span className="text-sm font-medium text-text-primary">{column.label}</span>
        <span className="text-xs text-text-muted bg-bg-primary px-1.5 py-0.5 rounded-full">
          {sessionIds.length}
        </span>
        <div className="flex-1" />
        {onClearAll && sessionIds.length > 0 && (
          <button
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            onClick={onClearAll}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-bg-primary/50 rounded-b-md">
        {sessionIds.length === 0 ? (
          <div className="text-xs text-text-muted text-center py-6">
            {column.emptyMessage}
          </div>
        ) : (
          sessionIds.map((sessionId) => (
            <KanbanCard
              key={sessionId}
              sessionId={sessionId}
              shortTime={shortTimesBySessionId[sessionId] ?? ''}
              isSelected={sessionId === selectedSessionId}
              onSelect={onSelectSession}
              onExpand={onExpandSession}
              onKill={onKillSession}
              onDelete={onDeleteSession}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default KanbanColumn;
