import { useCallback, useEffect, useRef } from 'react';
import { useEphemeralCommandStore } from '../../stores/ephemeral-command-store';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { runEphemeralCommand } from '../../utils/session-actions';

const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT_RATIO = 0.5; // 50% of viewport

/** Strip ANSI escape sequences for plain-text display. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

function PanelToolbar(): React.JSX.Element {
  const selectedCommandId = useEphemeralCommandStore((s) => s.selectedCommandId);
  const commands = useEphemeralCommandStore((s) => s.commands);
  const panelPinned = useEphemeralCommandStore((s) => s.panelPinned);
  const togglePanelPinned = useEphemeralCommandStore((s) => s.togglePanelPinned);
  const setPanelExpanded = useEphemeralCommandStore((s) => s.setPanelExpanded);
  const dismissCommand = useEphemeralCommandStore((s) => s.dismissCommand);

  const selected = commands.find((c) => c.id === selectedCommandId);

  const handlePromote = useCallback(() => {
    if (!selected) return;
    // Open a new terminal session at the same CWD
    window.mcode.sessions.create({
      cwd: selected.cwd,
      sessionType: 'terminal',
    }).then((session) => {
      useSessionStore.getState().addSession(session);
      useLayoutStore.getState().addTile(session.sessionId);
      useLayoutStore.getState().persist();
      useSessionStore.getState().selectSession(session.sessionId);
    }).catch(console.error);
  }, [selected]);

  const handleRetry = useCallback(() => {
    if (!selected) return;
    runEphemeralCommand(selected.command, selected.cwd).catch(console.error);
  }, [selected]);

  const handleCopy = useCallback(() => {
    if (!selected) return;
    navigator.clipboard.writeText(stripAnsi(selected.output)).catch(console.error);
  }, [selected]);

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0">
      {/* Command tabs */}
      <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
        {commands.map((cmd) => (
          <button
            key={cmd.id}
            type="button"
            className={`
              px-2 py-0.5 text-xs font-mono rounded truncate max-w-[160px] cursor-pointer
              ${cmd.id === selectedCommandId ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-secondary'}
              ${cmd.status === 'error' ? 'text-red-400' : ''}
            `}
            onClick={() => useEphemeralCommandStore.getState().selectCommand(cmd.id)}
            title={cmd.command}
          >
            {cmd.command}
          </button>
        ))}
      </div>

      {/* Actions */}
      {selected && selected.status !== 'running' && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs text-text-secondary hover:text-text-primary bg-bg-secondary rounded cursor-pointer"
            onClick={handlePromote}
            title="Open a new terminal at this directory"
          >
            Promote
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs text-text-secondary hover:text-text-primary bg-bg-secondary rounded cursor-pointer"
            onClick={handleRetry}
            title="Re-run this command"
          >
            Retry
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs text-text-secondary hover:text-text-primary bg-bg-secondary rounded cursor-pointer"
            onClick={handleCopy}
            title="Copy output to clipboard"
          >
            Copy
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs text-text-muted hover:text-text-primary cursor-pointer"
            onClick={() => dismissCommand(selected.id)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Pin toggle */}
      <button
        type="button"
        className={`shrink-0 px-1 text-xs cursor-pointer ${panelPinned ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
        onClick={togglePanelPinned}
        title={panelPinned ? 'Unpin panel (auto-collapse when done)' : 'Pin panel open'}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          {panelPinned ? (
            <path d="M8 2v5M5 7h6M6 7v3l2 2 2-2V7" />
          ) : (
            <path d="M8 2v5M5 7h6M6 7v3l2 2 2-2V7" opacity="0.5" />
          )}
        </svg>
      </button>

      {/* Collapse */}
      <button
        type="button"
        className="shrink-0 px-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer"
        onClick={() => setPanelExpanded(false)}
        title="Collapse panel"
      >
        ▼
      </button>
    </div>
  );
}

function OutputView(): React.JSX.Element {
  const selectedCommandId = useEphemeralCommandStore((s) => s.selectedCommandId);
  const commands = useEphemeralCommandStore((s) => s.commands);
  const scrollRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);

  const selected = commands.find((c) => c.id === selectedCommandId);
  const output = selected ? stripAnsi(selected.output) : '';

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [output]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // User is at bottom if within 20px of the end
    autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  }, []);

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        No command selected
      </div>
    );
  }

  return (
    <pre
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs font-mono text-text-primary whitespace-pre-wrap break-all bg-bg-primary"
    >
      <span className="text-text-muted">$ {selected.command}</span>
      {'\n'}
      {output}
      {selected.status === 'running' && (
        <span className="text-text-muted animate-pulse">▊</span>
      )}
      {selected.status === 'error' && selected.exitCode !== null && (
        <span className="text-red-400">
          {'\n'}[Process exited with code {selected.exitCode}]
        </span>
      )}
    </pre>
  );
}

export default function BottomPanel(): React.JSX.Element | null {
  const panelExpanded = useEphemeralCommandStore((s) => s.panelExpanded);
  const panelHeight = useEphemeralCommandStore((s) => s.panelHeight);
  const setPanelHeight = useEphemeralCommandStore((s) => s.setPanelHeight);
  const commands = useEphemeralCommandStore((s) => s.commands);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = panelHeight;

      const handleMouseMove = (me: MouseEvent): void => {
        const maxHeight = window.innerHeight * MAX_PANEL_HEIGHT_RATIO;
        // Dragging up increases height (startY - me.clientY is positive when moving up)
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

  if (!panelExpanded || commands.length === 0) return null;

  return (
    <>
      {/* Resize handle */}
      <div
        className="h-[3px] cursor-row-resize shrink-0 hover:bg-border-focus/50 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />
      {/* Panel content */}
      <div
        className="shrink-0 flex flex-col bg-bg-elevated border-t border-border-subtle"
        style={{ height: panelHeight }}
      >
        <PanelToolbar />
        <OutputView />
      </div>
    </>
  );
}
