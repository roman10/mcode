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
  HIDDEN_TILE_DISPOSE_MS,
  MAX_SCROLLBACK_LINES,
  SCROLLBACK_PRESETS,
} from '@shared/constants';
import { getAgentDefinition, shouldHideTerminalCursor } from '@shared/session-agents';
import { terminalRegistry } from '../../devtools/terminal-registry';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import { useSessionStore } from '../../stores/session-store';
import { useSlashCommandWarningStore } from '../../stores/slash-command-warning-store';
import ContextMenu, { type MenuItem } from '../shared/ContextMenu';
import SearchBar from './SearchBar';
import { useTerminalSearch } from '../../hooks/useTerminalSearch';
import { normalizeAgentLabel } from '../../utils/label-utils';
import type { SessionType } from '@shared/types';
import {
  buildUnsupportedSlashCommandWarning,
  stripTerminalInputControlSequences,
} from '../../utils/slash-command-validation';

interface TerminalInstanceProps {
  sessionId: string;
  sessionType?: string;
  scrollbackLines?: number;
  /** When false the terminal is hidden via CSS. After HIDDEN_TILE_DISPOSE_MS the
   *  Terminal is fully disposed to free its scrollback; revealing it again
   *  recreates the Terminal and replays the broker ring buffer. */
  isVisible?: boolean;
}

function resolveScrollback(value: number | undefined): number {
  const lines = value ?? DEFAULT_SCROLLBACK_LINES;
  // Migration: legacy persisted value 0 ("unlimited") is coerced to MAX_SCROLLBACK_LINES.
  // Any out-of-range value is also clamped so the buffer stays bounded.
  if (lines <= 0) return MAX_SCROLLBACK_LINES;
  return Math.min(lines, MAX_SCROLLBACK_LINES);
}

function TerminalInstance({ sessionId, sessionType, scrollbackLines, isVisible = true }: TerminalInstanceProps): React.JSX.Element {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglRef = useRef<ReturnType<typeof attachWebgl> | null>(null);
  const sessionTypeRef = useRef(sessionType);
  sessionTypeRef.current = sessionType;
  const slashCommandBufferRef = useRef('');
  const knownSlashCommandsRef = useRef<Set<string>>(new Set());
  const warningTimeoutRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [currentScrollback, setCurrentScrollback] = useState(scrollbackLines);
  /** False when the tile has been hidden long enough that its xterm instance was disposed
   *  to free scrollback memory. Flips back to true on reveal, which remounts the Terminal. */
  const [shouldMount, setShouldMount] = useState(isVisible);

  // Schedule disposal of the Terminal after the tile has been hidden for HIDDEN_TILE_DISPOSE_MS.
  // On reveal, immediately remount.
  useEffect(() => {
    if (isVisible) {
      setShouldMount(true);
      return;
    }
    const timer = window.setTimeout(() => setShouldMount(false), HIDDEN_TILE_DISPOSE_MS);
    return () => window.clearTimeout(timer);
  }, [isVisible]);
  const search = useTerminalSearch();
  const cwd = useSessionStore((s) => s.sessions[sessionId]?.cwd ?? '');
  const setSlashWarning = useSlashCommandWarningStore((s) => s.setWarning);
  const clearSlashWarning = useSlashCommandWarningStore((s) => s.clearWarning);

  useEffect(() => {
    const agent = getAgentDefinition(sessionTypeRef.current);
    if (!agent || !cwd) {
      knownSlashCommandsRef.current = new Set();
      return;
    }
    let stale = false;
    window.mcode.slashCommands.scan(agent.sessionType, cwd).then((commands) => {
      if (!stale) {
        knownSlashCommandsRef.current = new Set(commands.map((cmd) => cmd.name.toLowerCase()));
      }
    }).catch(() => {
      if (!stale) knownSlashCommandsRef.current = new Set();
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionType is read via ref
  }, [cwd]);

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

  // Re-fit the terminal when it becomes visible (display:none → visible).
  // Hidden elements have zero dimensions so fit() must wait until visible.
  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setTimeout(() => { fitAddonRef.current?.fit(); }, 0);
    return () => clearTimeout(timer);
  }, [isVisible]);

  // Detach WebGL from hidden terminals to free contexts (capped at 6);
  // re-attach when the terminal becomes visible again.
  useEffect(() => {
    const handle = webglRef.current;
    if (!handle) return;
    if (isVisible) {
      if (!handle.active) handle.reattach();
    } else {
      if (handle.active) handle.detach();
    }
  }, [isVisible]);

  useEffect(() => {
    if (!shouldMount) return;
    const container = termRef.current;
    if (!container || sessionType === undefined) return;

    // All agent CLIs get a non-blinking bar cursor in accent color, hidden
    // when inactive. Agents that manage their own cursor via DECTCEM escape
    // sequences (hidesTerminalCursor: true) also get an initial \e[?25l so
    // xterm's cursor stays out of the way until the CLI sends \e[?25h.
    const isAgent = !!getAgentDefinition(sessionType);
    const hideCursorInitially = shouldHideTerminalCursor(sessionType);
    const term = new Terminal({
      cursorBlink: !isAgent,
      cursorStyle: isAgent ? 'bar' : undefined,
      cursorInactiveStyle: isAgent ? 'none' : undefined,
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: darkTheme,
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
    if (hideCursorInitially) {
      term.write('\x1b[?25l'); // hide cursor initially; agent CLI shows when ready
    }

    // Suppress \x1b[3J (Erase Scrollback) to preserve terminal history.
    // CLI tools (Claude Code, Gemini, Copilot) send this during TUI redraws,
    // which destroys the xterm.js scrollback buffer. ED 0/1/2 (erase visible
    // regions) still work normally — only the scrollback-clearing variant is blocked.
    const edHandler = term.parser.registerCsiHandler({ final: 'J' }, params => params[0] === 3);
    const edHandlerDec = term.parser.registerCsiHandler({ prefix: '?', final: 'J' }, params => params[0] === 3);

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
    webglRef.current = webgl;

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

    // Fit before replay: cursor-position / clear-screen escapes in the
    // buffered bytes are interpreted at the terminal's current cols/rows,
    // so a fresh 80x24 grid would land replayed prompts off-screen.
    // setTimeout (not rAF) so this fires when Electron isn't actively painting.
    const initialFitTimer = window.setTimeout(() => {
      fitAddon.fit();
      window.mcode.pty
        .getReplayData(sessionId)
        .then((data) => {
          if (data && termInstanceRef.current === term) term.write(data);
        })
        .catch(() => {
          // Session may not exist yet or PTY already exited
        });
    }, 0);

    // PTY data → terminal
    const unsubData = window.mcode.pty.onData((id, data) => {
      if (id === sessionId) term.write(data);
    });

    // PTY exit → terminal
    const unsubExit = window.mcode.pty.onExit((id, { code, signal }) => {
      if (id === sessionId) {
        // Reset terminal modes the exiting process may not have cleaned up.
        // Without this, a crashed/killed CLI leaves stale mouse tracking,
        // alternate screen, or bracketed paste mode active.
        term.write(
          '\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l' + // mouse tracking off
          '\x1b[?1049l' +  // exit alternate screen
          '\x1b[?25h' +    // show cursor
          '\x1b[?2004l',   // bracketed paste off
        );
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        term.write(`\r\n\x1b[90m[Process exited with ${detail}]\x1b[0m\r\n`);
      }
    });

    // Terminal input → PTY
    term.onData((data) => {
      const agent = getAgentDefinition(sessionTypeRef.current);
      const sanitizedData = stripTerminalInputControlSequences(data);
      for (const char of sanitizedData) {
        if (char === '\r' || char === '\n') {
          if (agent) {
            const warning = buildUnsupportedSlashCommandWarning(
              slashCommandBufferRef.current,
              knownSlashCommandsRef.current,
              agent.displayName,
            );
            if (warning) {
              setSlashWarning(sessionId, warning);
              if (warningTimeoutRef.current !== null) clearTimeout(warningTimeoutRef.current);
              warningTimeoutRef.current = window.setTimeout(() => {
                clearSlashWarning(sessionId);
                warningTimeoutRef.current = null;
              }, 6000);
            }
          }
          slashCommandBufferRef.current = '';
          continue;
        }
        if (char === '\x7f') {
          slashCommandBufferRef.current = slashCommandBufferRef.current.slice(0, -1);
          continue;
        }
        if (char === '\x15' || char === '\x03') {
          slashCommandBufferRef.current = '';
          continue;
        }
        if (char >= ' ' && char !== '\x1b') {
          slashCommandBufferRef.current += char;
        }
      }
      window.mcode.pty.write(sessionId, data);
    });

    // Auto-update session label from terminal title (e.g. Claude Code sets
    // a meaningful title like "add-auth-middleware" via OSC escape sequences).
    // Only updates if the user hasn't manually renamed the session (checked server-side).
    const unsubTitle = term.onTitleChange((title) => {
      if (title) {
        const normalized = sessionTypeRef.current ? normalizeAgentLabel(title, sessionTypeRef.current as SessionType) : title;
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
      if (warningTimeoutRef.current !== null) clearTimeout(warningTimeoutRef.current);
      clearSlashWarning(sessionId);
      edHandler.dispose();
      edHandlerDec.dispose();
      unsubResize.dispose();
      unsubTitle.dispose();
      unsubData();
      unsubExit();
      container.removeEventListener('contextmenu', handleContextMenu);
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
      container.removeEventListener('focus', focusHandler, true);
      webgl.detach();
      webglRef.current = null;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal setup runs once per sessionId; sessionType is read via ref
  }, [clearSlashWarning, sessionId, setSlashWarning, shouldMount]);

  const handleContextAction = useCallback((action: string) => {
    const term = termInstanceRef.current;
    if (!term) return;

    if (action.startsWith('scrollback:')) {
      const raw = parseInt(action.split(':')[1], 10);
      const value = resolveScrollback(raw);
      term.options.scrollback = value;
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
          label: v.toLocaleString(),
          action: `scrollback:${v}`,
          checked: effectiveScrollback === v,
        })),
      },
    ]
    : [];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', display: isVisible ? undefined : 'none' }}>
      {shouldMount ? (
        <div ref={termRef} style={{ width: '100%', height: '100%' }} />
      ) : (
        <div style={{ width: '100%', height: '100%' }} />
      )}
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
