import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { darkTheme } from '../../styles/theme';
import {
  TERMINAL_FONT_SIZE,
  TERMINAL_FONT_FAMILY,
  DEFAULT_SCROLLBACK_LINES,
  SCROLLBACK_PRESETS,
} from '../../../shared/constants';
import { terminalRegistry } from '../../devtools/terminal-registry';
import { useLayoutStore } from '../../stores/layout-store';
import ContextMenu, { type MenuItem } from '../shared/ContextMenu';
import SearchBar from './SearchBar';
import { useTerminalSearch } from '../../hooks/useTerminalSearch';

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [currentScrollback, setCurrentScrollback] = useState(scrollbackLines);
  const search = useTerminalSearch();

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    // Claude Code draws its own cursor character; hide the real xterm cursor
    // to prevent a stray blinking block on the last terminal row.
    const hideCursor = sessionType === 'claude';
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
        case 'v':
          navigator.clipboard.readText().then((text) => {
            if (text) term.paste(text);
          }).catch(() => { /* clipboard permission denied */ });
          return false;
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

        // --- Close / Kill ---
        case 'w': {
          const { removeTile, persist } = useLayoutStore.getState();
          if (event.shiftKey) {
            window.mcode.sessions.kill(sessionId).catch(console.error);
          }
          removeTile(sessionId);
          persist();
          return false;
        }

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

    // WebGL addon must load AFTER term.open() (requires DOM attachment)
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed, falling back to canvas renderer:', e);
    }

    // Centralize PTY resize: xterm.js fires onResize whenever cols/rows
    // actually change — from fitAddon.fit(), font zoom, or any other trigger.
    // Register BEFORE the first fitAddon.fit() so the initial fit is captured.
    const unsubResize = term.onResize(({ cols, rows }) => {
      window.mcode.pty.resize(sessionId, cols, rows);
    });

    // Defer initial fit to after browser layout is finalized.
    // The ResizeObserver below is a second safety net.
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

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

    // Context menu
    const handleContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // Resize handling with rAF debounce
    let resizeRaf = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    resizeObserver.observe(container);

    return () => {
      termInstanceRef.current = null;
      terminalRegistry.delete(sessionId);
      cancelAnimationFrame(resizeRaf);
      unsubResize.dispose();
      unsubData();
      unsubExit();
      container.removeEventListener('contextmenu', handleContextMenu);
      resizeObserver.disconnect();
      webglAddon?.dispose();
      term.dispose();
    };
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
        }).catch(() => {});
        break;
      case 'selectAll':
        term.selectAll();
        break;
      case 'clear':
        term.clear();
        break;
    }
  }, [sessionId]);

  const handleContextClose = useCallback(() => setContextMenu(null), []);

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
