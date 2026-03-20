import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import FileViewerTile from '../FileViewer/FileViewerTile';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

function KanbanFilePanel(): React.JSX.Element {
  const kanbanOpenFiles = useLayoutStore((s) => s.kanbanOpenFiles);
  const kanbanActiveFile = useLayoutStore((s) => s.kanbanActiveFile);
  const closeKanbanFile = useLayoutStore((s) => s.closeKanbanFile);
  const setKanbanActiveFile = useLayoutStore((s) => s.setKanbanActiveFile);
  const clearKanbanFiles = useLayoutStore((s) => s.clearKanbanFiles);

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation();
      closeKanbanFile(filePath);
    },
    [closeKanbanFile],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'w' && kanbanActiveFile) {
        e.preventDefault();
        e.stopPropagation();
        closeKanbanFile(kanbanActiveFile);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        clearKanbanFiles();
      }
    },
    [kanbanActiveFile, closeKanbanFile, clearKanbanFiles],
  );

  const filenameFromPath = (path: string): string => {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  };

  return (
    <div
      className="flex flex-col h-full w-full outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Tab strip */}
      <div className="flex items-center h-8 bg-bg-secondary border-b border-border-default shrink-0 overflow-x-auto [-webkit-app-region:no-drag]">
        {kanbanOpenFiles.map((filePath) => {
          const isActive = filePath === kanbanActiveFile;
          return (
            <button
              key={filePath}
              className={`flex items-center gap-1.5 h-full px-3 text-xs border-r border-border-default shrink-0 transition-colors ${
                isActive
                  ? 'bg-bg-primary text-text-primary'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              onClick={() => setKanbanActiveFile(filePath)}
              title={filePath}
            >
              <span className="truncate max-w-[160px]">{filenameFromPath(filePath)}</span>
              <span
                className="text-text-muted hover:text-text-primary ml-0.5 rounded p-0.5 hover:bg-bg-tertiary"
                onClick={(e) => handleCloseTab(e, filePath)}
                role="button"
                tabIndex={-1}
              >
                <X size={12} strokeWidth={1.5} />
              </span>
            </button>
          );
        })}
      </div>

      {/* File content */}
      <div className="flex-1 min-h-0">
        {kanbanActiveFile && (
          <FileViewerTile key={kanbanActiveFile} absolutePath={kanbanActiveFile} />
        )}
      </div>
    </div>
  );
}

export default KanbanFilePanel;
