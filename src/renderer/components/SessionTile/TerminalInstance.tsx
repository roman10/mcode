import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { attachWebgl } from '../../utils/webgl-lifecycle';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { darkTheme } from '../../styles/theme';
import {
  TERMINAL_FONT_SIZE,
  TERMINAL_FONT_FAMILY,
  DEFAULT_SCROLLBACK_LINES,
  SCROLLBACK_PRESETS,
} from '@shared/constants';
import { shouldHideTerminalCursor } from '@shared/session-agents';
import { terminalRegistry } from '../../devtools/terminal-registry';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import ContextMenu, { type MenuItem } from '../shared/ContextMenu';
import SearchBar from './SearchBar';
import { useTerminalSearch } from '../../hooks/useTerminalSearch';
import { normalizeAgentLabel } from '../../utils/label-utils';
import type { SessionType } from '@shared/types';

interface TerminalInstanceProps {
  sessionId: string;
  sessionType?: string;
  scrollbackLines?: number;
}

function resolveScrollback(value: number | undefined): number {
  const lines = value ?? DEFAULT_SCROLLBACK_LINES;
  return lines === 0 ? Infinity : lines;
}

function TerminalInstance({ sessionId, sessionType, scrollbackLines }: TerminalInstanceProps): React.JSX.Element {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [currentScrollback, setCurrentScrollback] = useState(scrollbackLines);
  const search = useTerminalSearch();

  // Subscribe to terminal panel height changes so that fit() is called even when
  // ResizeObserver doesn't fire (e.g. in background/non-painting Electron windows).
  useEffect(() => {
    let lastH = useTerminalPanelStore.getState().panelHeight;
    const unsub = useTerminalPanelStore.subscribe((s) => {
      if (s.panelHeight !== lastH) {
        lastH = s.panelHeight;
        // Delay one tick so the DOM layout has propagated from the state change.
        window.setTimeout(() => { fitAddonRef.current?.fit(); }, 0);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    // Claude Code draws its own cursor character; hide the real xterm cursor
    // to prevent a stray blinking block on the last terminal row.
    const hideCursor = shouldHideTerminalCursor(sessionType);
    const term = new Terminal({
      cursorBlink: !hideCursor,
      cursorInactiveStyle: hideCursor ? 'none' : undefined,
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: hideCursor ? { ...darkTheme, cursor: darkTheme.background } : darkTheme,
      allowProposedApi: true,
      scrollback: resolveScrollback(scrollbackLines),
    });

    termInstanceRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    search.attach(term);

    term.open(container);
    terminalRegistry.set(sessionId, term);

    // Intercept OS-level shortcuts before xterm sends them to the PTY
    const isMac = window.mcode.app.getPlatform() === 'darwin';
    term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.type !== 'keydown') return true;

      switch (event.key) {
        // --- Clipboard ---
        case 'c': {
          const selection = term.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection);
            return false;
          }
          return true; // no selection → SIGINT (\x03)
        }
        // Cmd+V: handled natively by Electron's Edit menu { role: 'paste' }
        // which triggers a paste event on xterm's textarea — no custom handling needed.
        case 'a':
          term.selectAll();
          return false;

        // --- Clear ---
        case 'k':
          term.clear();
          return false;

        // --- Find ---
        case 'f':
          search.open();
          return false;

        // --- New terminal / New session (menu accelerators; block PTY) ---
        case 't':
        case 'n':
          return false;

        // --- Close / Kill (TerminalTile onKeyDown; block PTY) ---
        case 'w':
          return false;

        // --- Split / Maximize (TerminalTile onKeyDown; block PTY) ---
        case 'd':
        case 'Enter':
          return false;

        // --- Session focus nav / sidebar toggle / shortcuts dialog (menu accelerators; block PTY) ---
        case ']':
        case '[':
        case '\\':
        case '/':
          return false;

        // --- Zoom ---
        case '=':
        case '+':
          term.options.fontSize = Math.min(32, (term.options.fontSize ?? TERMINAL_FONT_SIZE) + 1);
          fitAddon.fit();
          return false;
        case '-':
          term.options.fontSize = Math.max(8, (term.options.fontSize ?? TERMINAL_FONT_SIZE) - 1);
          fitAddon.fit();
          return false;
        case '0':
          term.options.fontSize = TERMINAL_FONT_SIZE;
          fitAddon.fit();
          return false;

        default:
          return true;
      }
    });

    // WebGL addon must load AFTER term.open() (requires DOM attachment).
    // attachWebgl handles context-loss recovery and caps total active contexts
    // to prevent the browser from evicting older terminals' WebGL state.
    const webgl = attachWebgl(term, sessionId);

    // When the terminal gains focus and WebGL was lost, try to re-attach.
    // This recovers rendering quality after transient context exhaustion.
    const focusHandler = () => {
      if (!webgl.active) {
        window.setTimeout(() => {
          if (!webgl.active && termInstanceRef.current === term) {
            webgl.reattach();
          }
        }, 500);
      }
    };
    container.addEventListener('focus', focusHandler, true);

    // PTY resize chain (verified correct at runtime — PTY and xterm cols always match):
    //   ResizeObserver(container) → rAF → fitAddon.fit() → xterm.resize()
    //   → term.onResize → IPC pty:resize → node-pty resize → SIGWINCH
    // Any remaining line-wrap issues in Claude Code plan mode input are
    // upstream in Claude Code's own SIGWINCH / reflow handling.
    const unsubResize = term.onResize(({ cols, rows }) => {
      window.mcode.pty.resize(sessionId, cols, rows);
    });

    // Defer initial fit to after browser layout is finalized.
    // Using setTimeout instead of requestAnimationFrame so this fires even
    // when the Electron window is not actively painting (e.g. during tests).
    const initialFitTimer = window.setTimeout(() => { fitAddon.fit(); }, 0);

    // Replay buffered output before attaching live listener
    window.mcode.pty
      .getReplayData(sessionId)
      .then((data) => {
        if (data) term.write(data);
      })
      .catch(() => {
        // Session may not exist yet or PTY already exited
      });

    // PTY data → terminal
    const unsubData = window.mcode.pty.onData((id, data) => {
      if (id === sessionId) term.write(data);
    });

    // PTY exit → terminal
    const unsubExit = window.mcode.pty.onExit((id, { code, signal }) => {
      if (id === sessionId) {
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        term.write(`\r\n\x1b[90m[Process exited with ${detail}]\x1b[0m\r\n`);
      }
    });

    // Terminal input → PTY
    term.onData((data) => {
      window.mcode.pty.write(sessionId, data);
    });

    // Auto-update session label from terminal title (e.g. Claude Code sets
    // a meaningful title like "add-auth-middleware" via OSC escape sequences).
    // Only updates if the user hasn't manually renamed the session (checked server-side).
    const unsubTitle = term.onTitleChange((title) => {
      if (title) {
        const normalized = sessionType ? normalizeAgentLabel(title, sessionType as SessionType) : title;
        window.mcode.sessions.setAutoLabel(sessionId, normalized);
      }
    });

    // Context menu
    const handleContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // Resize handling with setTimeout debounce.
    // requestAnimationFrame is not used here because it does not fire when the
    // Electron window is not actively painting (e.g. tests, background window).
    // setTimeout(0) fires regardless and is sufficient for post-layout fit().
    let resizeTimer = 0;
    const scheduleFit = (): void => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { fitAddon.fit(); }, 0);
    };

    const resizeObserver = new ResizeObserver(() => { scheduleFit(); });
    resizeObserver.observe(container);

    // MutationObserver on the terminal panel element catches panel height
    // changes that come via inline-style updates (e.g. terminal_panel_set_height).
    // This fires synchronously on DOM mutations even when Electron is not
    // actively painting, unlike ResizeObserver which requires the rendering loop.
    const panelEl = container.closest('[data-terminal-panel]');
    const mutationObserver = panelEl
      ? new MutationObserver(() => { scheduleFit(); })
      : null;
    mutationObserver?.observe(panelEl!, { attributes: true, attributeFilter: ['style'] });

    return () => {
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      terminalRegistry.delete(sessionId);
      clearTimeout(initialFitTimer);
      clearTimeout(resizeTimer);
      unsubResize.dispose();
      unsubTitle.dispose();
      unsubData();
      unsubExit();
      container.removeEventListener('contextmenu', handleContextMenu);
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
      container.removeEventListener('focus', focusHandler, true);
      webgl.detach();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal setup must only re-run on identity change
  }, [sessionId, sessionType]);

  const handleContextAction = useCallback((action: string) => {
    const term = termInstanceRef.current;
    if (!term) return;

    if (action.startsWith('scrollback:')) {
      const value = parseInt(action.split(':')[1], 10);
      term.options.scrollback = value === 0 ? Infinity : value;
      setCurrentScrollback(value);
      window.mcode.sessions.setTerminalConfig(sessionId, { scrollbackLines: value });
      return;
    }

    switch (action) {
      case 'copy': {
        const selection = term.getSelection();
        if (selection) navigator.clipboard.writeText(selection);
        break;
      }
      case 'paste':
        navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        }).catch(() => { });
        break;
      case 'selectAll':
        term.selectAll();
        break;
      case 'clear':
        term.clear();
        break;
    }
  }, [sessionId]);

  const handleContextClose = useCallback(() => {
    setContextMenu(null);
    // Restore focus to the terminal after the context menu closes,
    // otherwise the terminal won't accept keyboard input.
    termInstanceRef.current?.focus();
  }, []);

  const effectiveScrollback = currentScrollback ?? DEFAULT_SCROLLBACK_LINES;
  const contextMenuItems: MenuItem[] = contextMenu
    ? [
      { label: 'Copy', action: 'copy', enabled: !!termInstanceRef.current?.hasSelection() },
      { label: 'Paste', action: 'paste' },
      { label: 'Select All', action: 'selectAll' },
      { label: '', action: 'sep', separator: true },
      { label: 'Clear Terminal', action: 'clear' },
      { label: '', action: 'sep2', separator: true },
      {
        label: 'Scrollback Lines',
        action: 'scrollback',
        children: SCROLLBACK_PRESETS.map((v) => ({
          label: v === 0 ? 'Unlimited' : v.toLocaleString(),
          action: `scrollback:${v}`,
          checked: effectiveScrollback === v,
        })),
      },
    ]
    : [];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div ref={termRef} style={{ width: '100%', height: '100%' }} />
      {search.isOpen && (
        <SearchBar
          onFindNext={search.findNext}
          onFindPrevious={search.findPrevious}
          onClose={() => {
            search.close();
            termInstanceRef.current?.focus();
          }}
          resultIndex={search.resultIndex}
          resultCount={search.resultCount}
        />
      )}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onAction={handleContextAction}
          onClose={handleContextClose}
        />
      )}
    </div>
  );
}

export default TerminalInstance;
