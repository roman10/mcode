import { useCallback, useEffect, useRef } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import TerminalPanelToolbar from './TerminalPanelToolbar';
import TerminalSplitContainer from './TerminalSplitContainer';

const MIN_PANEL_HEIGHT = 100;
const MIN_LAYOUT_HEIGHT = 100;

export default function TerminalPanel(): React.JSX.Element | null {
  const panelVisible = useTerminalPanelStore((s) => s.panelVisible);
  const panelHeight = useTerminalPanelStore((s) => s.panelHeight);
  const setPanelHeight = useTerminalPanelStore((s) => s.setPanelHeight);
  const splitTree = useTerminalPanelStore((s) => s.splitTree);
  const terminals = useTerminalPanelStore((s) => s.terminals);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Max panel height based on actual container size (no hardcoded sibling heights). */
  const getMaxHeight = useCallback(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return window.innerHeight - MIN_LAYOUT_HEIGHT;
    return Math.max(MIN_PANEL_HEIGHT, container.clientHeight - MIN_LAYOUT_HEIGHT);
  }, []);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = panelRef.current?.clientHeight ?? panelHeight;

      const handleMouseMove = (me: MouseEvent): void => {
        const maxHeight = getMaxHeight();
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
    [panelHeight, setPanelHeight, getMaxHeight],
  );

  const hasTerminals = Object.keys(terminals).length > 0;
  const isRendered = panelVisible && hasTerminals;

  // Re-clamp panel height on window resize and when the panel becomes visible
  // (fixes stale persisted values from a larger window).
  useEffect(() => {
    if (!isRendered) return;
    const clamp = (): void => {
      const max = getMaxHeight();
      const current = useTerminalPanelStore.getState().panelHeight;
      if (current > max) setPanelHeight(max);
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [getMaxHeight, setPanelHeight, isRendered]);

  if (!isRendered) return null;

  return (
    <>
      {/* Resize handle */}
      <div
        className="h-[3px] cursor-row-resize shrink-0 hover:bg-border-focus/50 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />
      {/* Panel content */}
      <div
        ref={panelRef}
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
