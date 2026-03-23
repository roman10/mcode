import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useEphemeralCommandStore } from '../../stores/ephemeral-command-store';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { runEphemeralCommand } from '../../utils/session-actions';
import { darkTheme } from '../../styles/theme';
import { TERMINAL_FONT_FAMILY } from '@shared/constants';
import { stripAnsi } from '@shared/strip-ansi';

const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT_RATIO = 0.5; // 50% of viewport
const OUTPUT_FONT_SIZE = 12;
const PANEL_COLLAPSE_DELAY_MS = 3000;

function PanelToolbar(): React.JSX.Element {
  const selectedCommandId = useEphemeralCommandStore((s) => s.selectedCommandId);
  const commands = useEphemeralCommandStore((s) => s.commands);
  const panelPinned = useEphemeralCommandStore((s) => s.panelPinned);
  const togglePanelPinned = useEphemeralCommandStore((s) => s.togglePanelPinned);
  const setPanelExpanded = useEphemeralCommandStore((s) => s.setPanelExpanded);
  const dismissCommand = useEphemeralCommandStore((s) => s.dismissCommand);
  const killCommand = useEphemeralCommandStore((s) => s.killCommand);

  const selected = commands.find((c) => c.id === selectedCommandId);

  const handlePromote = useCallback(() => {
    if (!selected) return;
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

      {/* Kill button for running commands */}
      {selected && selected.status === 'running' && (
        <button
          type="button"
          className="px-1.5 py-0.5 text-xs text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 rounded cursor-pointer flex items-center gap-1 shrink-0"
          onClick={() => killCommand(selected.id)}
          title="Stop command"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
          Stop
        </button>
      )}

      {/* Actions for completed commands */}
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

/** Read-only xterm.js instance that renders ANSI-colored output. */
function OutputView(): React.JSX.Element {
  const selectedCommandId = useEphemeralCommandStore((s) => s.selectedCommandId);
  const commands = useEphemeralCommandStore((s) => s.commands);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  /** Tracks how many bytes of the current command's output have been written to xterm. */
  const writtenLenRef = useRef(0);
  /** Tracks which command ID the terminal is currently showing. */
  const renderedCommandIdRef = useRef<string | null>(null);
  /** Tracks whether the exit code message has been written for the current command. */
  const exitShownForRef = useRef<string | null>(null);

  const selected = commands.find((c) => c.id === selectedCommandId);

  // Initialize / tear down xterm when the container mounts/unmounts.
  // We use a callback ref so the terminal is created as soon as the div exists.
  const attachRef = useCallback((container: HTMLDivElement | null) => {
    // Tear down previous instance
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (termRef.current) { termRef.current.dispose(); termRef.current = null; fitRef.current = null; }

    containerRef.current = container;
    if (!container) return;

    const term = new Terminal({
      fontSize: OUTPUT_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: { ...darkTheme, cursor: darkTheme.background },
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      disableStdin: true,
      scrollback: 10000,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    writtenLenRef.current = 0;
    renderedCommandIdRef.current = null;
    exitShownForRef.current = null;

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => fit.fit());
    });
    ro.observe(container);
    roRef.current = ro;
  }, []);

  // Write output incrementally when selected command or its output changes
  const outputLen = selected?.output.length ?? 0;
  const selectedStatus = selected?.status;
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (!selected) {
      term.clear();
      term.reset();
      writtenLenRef.current = 0;
      renderedCommandIdRef.current = null;
      exitShownForRef.current = null;
      return;
    }

    // If switching to a different command, reset and rewrite from scratch
    if (renderedCommandIdRef.current !== selected.id) {
      term.clear();
      term.reset();
      writtenLenRef.current = 0;
      renderedCommandIdRef.current = selected.id;
      exitShownForRef.current = null;

      // Write the prompt line
      term.write(`\x1b[90m$ ${selected.command}\x1b[0m\r\n`);
    }

    // Write only the new portion of output
    const alreadyWritten = writtenLenRef.current;
    if (selected.output.length > alreadyWritten) {
      const newData = selected.output.slice(alreadyWritten);
      term.write(newData);
      writtenLenRef.current = selected.output.length;
    }

    // Show exit code for errors (once per command)
    if (selected.status === 'error' && selected.exitCode !== null && exitShownForRef.current !== selected.id) {
      exitShownForRef.current = selected.id;
      term.write(`\r\n\x1b[31m[Process exited with code ${selected.exitCode}]\x1b[0m`);
    }
  }, [selected, outputLen, selectedStatus]);

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        No command selected
      </div>
    );
  }

  return (
    <div ref={attachRef} className="flex-1 min-h-0 bg-bg-primary [&_.xterm-viewport]:!overflow-y-auto" />
  );
}

export default function BottomPanel(): React.JSX.Element | null {
  const panelExpanded = useEphemeralCommandStore((s) => s.panelExpanded);
  const panelHeight = useEphemeralCommandStore((s) => s.panelHeight);
  const setPanelHeight = useEphemeralCommandStore((s) => s.setPanelHeight);
  const setPanelExpanded = useEphemeralCommandStore((s) => s.setPanelExpanded);
  const commands = useEphemeralCommandStore((s) => s.commands);
  const autoCollapseScheduled = useEphemeralCommandStore((s) => s.autoCollapseScheduled);
  const cancelAutoCollapse = useEphemeralCommandStore((s) => s.cancelAutoCollapse);

  const [countdownPaused, setCountdownPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef(0);
  const resumedAtRef = useRef(0);

  // Manage the collapse timer
  useEffect(() => {
    if (!autoCollapseScheduled) {
      elapsedRef.current = 0;
      setCountdownPaused(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }

    elapsedRef.current = 0;
    resumedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      setPanelExpanded(false);
    }, PANEL_COLLAPSE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoCollapseScheduled, setPanelExpanded]);

  const handlePanelMouseEnter = useCallback(() => {
    if (!autoCollapseScheduled) return;
    setCountdownPaused(true);
    elapsedRef.current += Date.now() - resumedAtRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [autoCollapseScheduled]);

  const handlePanelMouseLeave = useCallback(() => {
    if (!autoCollapseScheduled) return;
    setCountdownPaused(false);
    resumedAtRef.current = Date.now();
    const remaining = PANEL_COLLAPSE_DELAY_MS - elapsedRef.current;
    if (remaining <= 0) {
      setPanelExpanded(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setPanelExpanded(false);
    }, remaining);
  }, [autoCollapseScheduled, setPanelExpanded]);

  const handlePanelClick = useCallback(() => {
    if (autoCollapseScheduled) {
      cancelAutoCollapse();
    }
  }, [autoCollapseScheduled, cancelAutoCollapse]);

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
        className="shrink-0 flex flex-col bg-bg-elevated border-t border-border-subtle relative"
        style={{ height: panelHeight }}
        onMouseEnter={handlePanelMouseEnter}
        onMouseLeave={handlePanelMouseLeave}
        onClick={handlePanelClick}
      >
        {/* Auto-collapse countdown bar */}
        {autoCollapseScheduled && (
          <div className="absolute top-0 left-0 right-0 h-[2px] z-10 overflow-hidden">
            <div
              className="h-full bg-accent/40"
              style={{
                animation: `ephemeral-countdown-deplete ${PANEL_COLLAPSE_DELAY_MS}ms linear forwards`,
                animationPlayState: countdownPaused ? 'paused' : 'running',
              }}
            />
          </div>
        )}
        <PanelToolbar />
        <OutputView />
      </div>
    </>
  );
}
