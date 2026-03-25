import { useCallback, useEffect, useRef } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import TerminalPanelToolbar from './TerminalPanelToolbar';
import TerminalSplitContainer from './TerminalSplitContainer';

const isMac = window.mcode.app.getPlatform() === 'darwin';

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
    const containerHeight = panelRef.current?.parentElement?.clientHeight ?? 0;
    return Math.max(MIN_PANEL_HEIGHT, containerHeight - MIN_LAYOUT_HEIGHT);
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;

    const panel = useTerminalPanelStore.getState();

    switch (e.key) {
      case 'd': {
        if (!panel.activeTabGroupId) return;
        e.preventDefault();
        e.stopPropagation();
        panel.splitTabGroup(panel.activeTabGroupId, e.shiftKey ? 'vertical' : 'horizontal');
        break;
      }
      case ']':
        e.preventDefault();
        e.stopPropagation();
        panel.cycleTab(1);
        break;
      case '[':
        e.preventDefault();
        e.stopPropagation();
        panel.cycleTab(-1);
        break;
      case 'w': {
        // Always consume Cmd+W in panel context — prevents it from bubbling to
        // the Electron menu and accidentally closing a mosaic tile.
        e.preventDefault();
        e.stopPropagation();
        if (!e.shiftKey) break;
        const entry = panel.getActiveTerminal();
        if (entry) {
          window.mcode.sessions.kill(entry.sessionId).catch(() => {});
          panel.removeTerminal(entry.sessionId);
        }
        break;
      }
    }
  }, []);

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
        onKeyDown={handleKeyDown}
      >
        <TerminalPanelToolbar />
        {splitTree && (
          <TerminalSplitContainer node={splitTree} />
        )}
      </div>
    </>
  );
}
