import { useCallback } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import TerminalPanelToolbar from './TerminalPanelToolbar';
import TerminalSplitContainer from './TerminalSplitContainer';

const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT_RATIO = 0.5;

export default function TerminalPanel(): React.JSX.Element | null {
  const panelVisible = useTerminalPanelStore((s) => s.panelVisible);
  const panelHeight = useTerminalPanelStore((s) => s.panelHeight);
  const setPanelHeight = useTerminalPanelStore((s) => s.setPanelHeight);
  const splitTree = useTerminalPanelStore((s) => s.splitTree);
  const terminals = useTerminalPanelStore((s) => s.terminals);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = panelHeight;

      const handleMouseMove = (me: MouseEvent): void => {
        const maxHeight = window.innerHeight * MAX_PANEL_HEIGHT_RATIO;
        const newHeight = Math.min(
          maxHeight,
          Math.max(MIN_PANEL_HEIGHT, startHeight + (startY - me.clientY)),
        );
        setPanelHeight(newHeight);
      };

      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelHeight, setPanelHeight],
  );

  const hasTerminals = Object.keys(terminals).length > 0;
  if (!panelVisible || !hasTerminals) return null;

  return (
    <>
      {/* Resize handle */}
      <div
        className="h-[3px] cursor-row-resize shrink-0 hover:bg-border-focus/50 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />
      {/* Panel content */}
      <div
        data-terminal-panel
        className="shrink-0 flex flex-col bg-bg-elevated border-t border-border-subtle"
        style={{ height: panelHeight }}
        tabIndex={-1}
      >
        <TerminalPanelToolbar />
        {splitTree && (
          <TerminalSplitContainer node={splitTree} />
        )}
      </div>
    </>
  );
}
