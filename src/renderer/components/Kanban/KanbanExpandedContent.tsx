import { useCallback, useRef } from 'react';
import { useLayoutStore } from '../../stores/layout-store';
import TerminalTile from '../SessionTile/TerminalTile';
import KanbanFilePanel from './KanbanFilePanel';

function KanbanExpandedContent({ sessionId }: { sessionId: string | null }): React.JSX.Element {
  const kanbanOpenFiles = useLayoutStore((s) => s.kanbanOpenFiles);
  const kanbanSplitRatio = useLayoutStore((s) => s.kanbanSplitRatio);
  const setKanbanSplitRatio = useLayoutStore((s) => s.setKanbanSplitRatio);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const handleMouseMove = (moveEvent: MouseEvent): void => {
        const rect = container.getBoundingClientRect();
        const ratio = Math.max(0.2, Math.min(0.8, (moveEvent.clientX - rect.left) / rect.width));
        setKanbanSplitRatio(ratio);
      };

      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [setKanbanSplitRatio],
  );

  const hasFiles = kanbanOpenFiles.length > 0;

  // Only files, no terminal
  if (!sessionId && hasFiles) {
    return (
      <div className="h-full w-full min-h-0 overflow-hidden">
        <KanbanFilePanel />
      </div>
    );
  }

  // Only terminal, no files
  if (sessionId && !hasFiles) {
    return (
      <div className="h-full w-full min-h-0 overflow-hidden">
        <TerminalTile sessionId={sessionId} />
      </div>
    );
  }

  // Both: horizontal split
  if (sessionId && hasFiles) {
    const leftPercent = kanbanSplitRatio * 100;
    return (
      <div ref={containerRef} className="flex h-full w-full min-h-0 overflow-hidden">
        <div className="h-full min-w-0 overflow-hidden" style={{ width: `${leftPercent}%` }}>
          <TerminalTile sessionId={sessionId} />
        </div>
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-border-focus/50 transition-colors"
          onMouseDown={handleMouseDown}
        />
        <div className="h-full flex-1 min-w-0 overflow-hidden">
          <KanbanFilePanel />
        </div>
      </div>
    );
  }

  // Shouldn't reach here, but fallback
  return <></>;
}

export default KanbanExpandedContent;
