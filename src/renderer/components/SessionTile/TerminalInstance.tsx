import { useCallback, useEffect, useRef, useState } from 'react';
import { getLeaves } from 'react-mosaic-component';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useShallow } from 'zustand/react/shallow';
import { attachWebgl, onWebglRecreateRequested } from '../../utils/webgl-lifecycle';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { darkTheme } from '../../styles/theme';
import {
  TERMINAL_FONT_SIZE,
  atlasIsolatedFontFamily,
  DEFAULT_SCROLLBACK_LINES,
  MAX_SCROLLBACK_LINES,
  SCROLLBACK_PRESETS,
} from '@shared/constants';
import { getAgentDefinition, shouldHideTerminalCursor } from '@shared/session-agents';
import {
  terminalRegistry,
  setTerminalLive,
  setTerminalFitAddon,
  forgetTerminalFitAddon,
} from '../../devtools/terminal-registry';
import { useTerminalDispose } from '../../hooks/useTerminalDispose';
import { useTerminalRefit } from '../../hooks/useTerminalRefit';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useTerminalStore } from '../../stores/terminal-store';
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
import { utf8ByteLength } from '../../utils/utf8-byte-length';
import {
  ensureSlashCommandsScan,
  getSlashCommandsCached,
} from '../../utils/slash-command-cache';
import { consumeFresh } from '../../utils/fresh-sessions';
import {
  subscribeToPtyData,
  subscribeToPtyExit,
} from '../../utils/pty-subscriptions';

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
  // Mirror of isVisible that the async initial-replay closure can read at
  // finally-time. The setup effect captures isVisible at mount only, so a
  // stale closure read would clobber the hide-effect's gate after a
  // visible→hidden transition during initial replay.
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const slashCommandBufferRef = useRef('');
  const knownSlashCommandsRef = useRef<Set<string>>(new Set());
  const warningTimeoutRef = useRef<number | null>(null);
  // Local mirror of broker's per-session monotonic byte offset. Seeded from
  // getReplaySince(0) at mount and incremented per pty.onData chunk so the
  // value stays in lockstep with broker between catch-up resyncs.
  const byteOffsetRef = useRef<number>(0);
  // Catch-up offset for the next reveal: set when the tile becomes hidden
  // (or stays hidden through initial replay), cleared once a reveal-time
  // catch-up has run. null means no pending catch-up.
  const hiddenAtOffsetRef = useRef<number | null>(null);
  // "Drop live writes" gate, separate from the catch-up offset above so the
  // initial replay (which gates writes but has no catch-up offset) doesn't
  // trip the hide/reveal effect. True during initial replay, while hidden,
  // and mid-catch-up; cleared once writes can flow into xterm directly.
  const dropLiveWritesRef = useRef<boolean>(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [currentScrollback, setCurrentScrollback] = useState(scrollbackLines);
  const shouldMount = useTerminalDispose(isVisible, sessionId);
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
    const cached = getSlashCommandsCached(agent.sessionType, cwd);
    if (cached) {
      knownSlashCommandsRef.current = cached;
      return;
    }
    let stale = false;
    ensureSlashCommandsScan(agent.sessionType, cwd).then((set) => {
      if (!stale) knownSlashCommandsRef.current = set;
    });
    return () => { stale = true; };
  }, [cwd]);
  const panelHeight = useTerminalPanelStore((s) => s.panelHeight);
  // Stable string key of the overlay's leaves: changes on enter / leave /
  // split but NOT on every overlay drag-resize (those object-identity changes
  // would thrash scheduleRefit; the ResizeObserver already covers pure resize).
  const { mosaicTree, maximizedKey } = useLayoutStore(useShallow((s) => ({
    mosaicTree: s.mosaicTree,
    maximizedKey:
      s.maximizedTree == null ? '' : getLeaves(s.maximizedTree).slice().sort().join(','),
  })));
  const [sessionStatus, attentionReason] = useSessionStore(
    useShallow((s) => [
      s.sessions[sessionId]?.status,
      s.sessions[sessionId]?.attentionReason,
    ] as const),
  );

  const { safeFit, scheduleRefit } = useTerminalRefit({
    termRef, fitAddonRef, isVisibleRef, sessionId,
  });

  useEffect(() => {
    if (!shouldMount) return;
    scheduleRefit();
  }, [panelHeight, scheduleRefit, shouldMount]);

  // Backstop for tile resize/maximize: ResizeObserver normally fires on mosaic
  // layout transitions, but Electron's render loop can drop those callbacks
  // when the window isn't actively painting. Subscribing directly to the
  // layout state guarantees fit() runs on every maximize / restore / split.
  // maximizedKey drives the overlay portal in MosaicLayout — when a tile enters
  // or leaves the overlay (or the overlay splits) its container changes size
  // (mosaic pane → overlay slot bounds and back), so we re-fit on that too.
  useEffect(() => {
    if (!shouldMount) return;
    scheduleRefit();
  }, [mosaicTree, maximizedKey, scheduleRefit, shouldMount]);

  // TileTaskPanel inserts the plan-mode "Needs response" banner (and the panel
  // wrapper itself, if no tasks were queued) when the session transitions to
  // status='waiting' + attentionReason='Waiting for your response'; the state
  // ExitPlanMode / AskUserQuestion drive via session-state-machine. That adds a
  // flex child above the terminal and shrinks termRef. ResizeObserver picks up
  // most reflows, but the dimension-mismatch failure mode b1773fd documented
  // for the post-maximize setTimeout(0) fit applies to it too: a single
  // ResizeObserver-scheduled fit can land before layout fully settles and lock
  // the terminal at stale rows. Subscribe to the session fields TileTaskPanel
  // actually reads so the multi-pass refit runs deterministically on banner
  // toggle, independent of ResizeObserver timing.
  useEffect(() => {
    if (!shouldMount) return;
    if (sessionStatus == null) return;
    scheduleRefit();
  }, [sessionStatus, attentionReason, scheduleRefit, shouldMount]);

  // Re-fit the terminal when it becomes visible (display:none → visible).
  // Hidden elements have zero dimensions so fit() must wait until visible.
  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setTimeout(safeFit, 0);
    return () => clearTimeout(timer);
  }, [isVisible, safeFit]);

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

  // Hide → reveal catch-up. While hidden, the pty.onData handler drops live
  // term.write calls (it still increments byteOffsetRef so the mirror stays
  // in sync with broker). On reveal, fetch only the bytes that arrived
  // during the hidden window via getReplaySince(hiddenAtOffsetRef) — preserves
  // pre-hide xterm scrollback. Falls back to term.clear() + full replay only
  // when the broker ring buffer wrapped past the hide-time offset.
  //
  // Only applies when xterm is currently mounted (shouldMount). After the
  // 5-min HIDDEN_TILE_DISPOSE_MS dispose path, the xterm is recreated and
  // the initial-replay path covers catch-up.
  useEffect(() => {
    if (!shouldMount) return;

    if (!isVisible) {
      hiddenAtOffsetRef.current = byteOffsetRef.current;
      dropLiveWritesRef.current = true;
      setTerminalLive(sessionId, false);
      return;
    }

    if (hiddenAtOffsetRef.current === null) return;
    const startOffset = hiddenAtOffsetRef.current;
    const term = termInstanceRef.current;
    if (!term) {
      hiddenAtOffsetRef.current = null;
      return;
    }

    dropLiveWritesRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r1 = await window.mcode.pty.getReplaySince(sessionId, startOffset);
        if (cancelled || termInstanceRef.current !== term) return;
        if (r1.dataStartOffset > startOffset) term.clear();
        if (r1.data) term.write(r1.data);
        let cursor = r1.currentOffset;
        // Bridge anything that arrived during the await. Bounded so heavy
        // output doesn't trap us in this loop; if we hit the cap, the next
        // live chunk closes the remaining gap (it's now ahead of cursor).
        // Note: we do NOT overwrite byteOffsetRef from cursor here. The local
        // mirror is faithfully maintained by per-chunk increments in the
        // pty.onData handler; overwriting from `cursor` (broker's offset at
        // the last IPC response time, possibly behind what pty.onData has
        // seen via in-flight pty:data events) would desync the mirror.
        for (let i = 0; i < 5 && cursor < byteOffsetRef.current; i++) {
          const r = await window.mcode.pty.getReplaySince(sessionId, cursor);
          if (cancelled || termInstanceRef.current !== term) return;
          if (r.data) term.write(r.data);
          // No-progress guard: broker reports the same offset (or earlier) we
          // already had. Happens when the session was deleted/unknown — broker
          // returns the {0,0,0} fallback. Without this we'd waste the full
          // MAX_BRIDGE budget on identical IPC roundtrips.
          if (r.currentOffset <= cursor) break;
          cursor = r.currentOffset;
        }
      } catch (err) {
        // IPC failure — clear the gate so live writes resume. Visible state
        // may be stale; the 5-min dispose-and-remount path is the backstop.
        console.warn('[TerminalInstance] hide/reveal catch-up failed', err);
      } finally {
        if (!cancelled) {
          hiddenAtOffsetRef.current = null;
          dropLiveWritesRef.current = false;
          setTerminalLive(sessionId, true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isVisible, shouldMount, sessionId]);

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
      // Per-terminal family => private WebGL texture atlas (see
      // atlasIsolatedFontFamily). Renders identically to TERMINAL_FONT_FAMILY.
      fontFamily: atlasIsolatedFontFamily(sessionId),
      theme: darkTheme,
      allowProposedApi: true,
      scrollback: resolveScrollback(scrollbackLines),
    });

    termInstanceRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    setTerminalFitAddon(sessionId, fitAddon);
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    search.attach(term);

    term.open(container);
    if (hideCursorInitially) {
      term.write('\x1b[?25l'); // hide cursor initially; agent CLI shows when ready
    }

    // Suppressing \x1b[3J (Erase Scrollback) preserves history when CLI tools
    // (Claude Code, Codex, Copilot) send it during TUI redraws, but can leak
    // rendering remnants when a TUI repaints a shorter frame than before.
    // Off by default; users opt in via Settings → Terminal. ED 0/1/2 always pass.
    let edHandler: IDisposable | null = null;
    let edHandlerDec: IDisposable | null = null;
    const installEraseSuppression = (): void => {
      if (edHandler) return;
      edHandler = term.parser.registerCsiHandler({ final: 'J' }, params => params[0] === 3);
      edHandlerDec = term.parser.registerCsiHandler({ prefix: '?', final: 'J' }, params => params[0] === 3);
    };
    const removeEraseSuppression = (): void => {
      edHandler?.dispose();
      edHandlerDec?.dispose();
      edHandler = null;
      edHandlerDec = null;
    };
    if (useTerminalStore.getState().preserveScrollback) installEraseSuppression();
    const unsubPreserveScrollback = useTerminalStore.subscribe((s, prev) => {
      if (s.preserveScrollback === prev.preserveScrollback) return;
      if (s.preserveScrollback) installEraseSuppression();
      else removeEraseSuppression();
    });

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

    // Reattach WebGL on focus when it was previously detached (visibility
    // hide, MAX_WEBGL_CONTEXTS cap). 500ms delay lets visibility-driven
    // reattaches settle first. Capture-phase on the container because xterm
    // focuses its inner textarea (xterm.js exposes no onFocus event of its
    // own). Atlas isolation (private atlas per terminal) removes the need for
    // any focus-driven fleet-wide atlas clear.
    const focusHandler = (): void => {
      // Reattach branch covers MAX_WEBGL_CONTEXTS-eviction recovery — cap
      // eviction has no wake signal, so focus is the recovery trigger.
      if (!webgl.active) {
        window.setTimeout(() => {
          if (!webgl.active && termInstanceRef.current === term) {
            webgl.reattach();
          }
        }, 500);
      }
    };
    container.addEventListener('focus', focusHandler, true);

    // Wake-time WebGL recovery. Sleep/wake (and other display-stack events)
    // can leave webgl.active === true while the underlying GPU resources are
    // dead — onContextLoss does NOT fire and clearTextureAtlas() writes to a
    // defunct texture, so the terminal stays black. Only disposing the
    // WebglAddon and creating a fresh one recovers. The hidden / inactive
    // checks defer to the visibility effect, which already reattaches on reveal.
    const unsubRecreate = onWebglRecreateRequested(() => {
      if (!isVisibleRef.current) return;
      if (!webgl.active) return;
      webgl.detach();
      webgl.reattach();
    });

    // PTY resize chain (verified correct at runtime — PTY and xterm cols always match):
    //   ResizeObserver(container) → rAF → fitAddon.fit() → xterm.resize()
    //   → term.onResize → IPC pty:resize → node-pty resize → SIGWINCH
    // Any remaining line-wrap issues in Claude Code plan mode input are
    // upstream in Claude Code's own SIGWINCH / reflow handling.
    const unsubResize = term.onResize(({ cols, rows }) => {
      window.mcode.pty.resize(sessionId, cols, rows);
      // Cheap single-terminal safety net: clear this terminal's (now private)
      // atlas synchronously after resize in case a grid change leaves drifted
      // glyph cells.
      term.clearTextureAtlas();
    });

    // (Re)mount: gate live writes until the initial replay completes. Without
    // the gate, pty.onData chunks arriving during the replay's IPC await would
    // be written alongside the replay data — the replay's snapshot also
    // includes those bytes (broker appends synchronously per chunk), so we'd
    // double-write. The bridge loop below catches up bytes added between the
    // IPC send and response.
    //
    // Exception: a freshly-created session has an empty broker ring buffer by
    // construction, so the replay round-trip would just return zero bytes. We
    // skip it and open the gate immediately, removing one IPC roundtrip and
    // one event-loop tick from the user-perceived "tile is empty" window.
    const skipInitialReplay = consumeFresh(sessionId) && isVisibleRef.current;
    hiddenAtOffsetRef.current = null;
    byteOffsetRef.current = 0;
    if (skipInitialReplay) {
      dropLiveWritesRef.current = false;
      setTerminalLive(sessionId, true);
    } else {
      dropLiveWritesRef.current = true;
      setTerminalLive(sessionId, false);
    }

    // Fit before replay: cursor-position / clear-screen escapes in the
    // buffered bytes are interpreted at the terminal's current cols/rows,
    // so a fresh 80x24 grid would land replayed prompts off-screen.
    // setTimeout (not rAF) so this fires when Electron isn't actively painting.
    let cancelledInitial = false;
    const initialFitTimer = window.setTimeout(() => {
      safeFit();
      if (skipInitialReplay) return;
      (async () => {
        try {
          const r = await window.mcode.pty.getReplaySince(sessionId, 0);
          if (cancelledInitial || termInstanceRef.current !== term) return;
          if (r.data) term.write(r.data);
          let cursor = r.currentOffset;
          // Catch up bytes that arrived after the snapshot was taken but
          // before this resolves (live pty.onData incremented byteOffsetRef
          // without writing, since the gate is active).
          for (let i = 0; i < 5 && cursor < byteOffsetRef.current; i++) {
            const r2 = await window.mcode.pty.getReplaySince(sessionId, cursor);
            if (cancelledInitial || termInstanceRef.current !== term) return;
            if (r2.data) term.write(r2.data);
            if (r2.currentOffset <= cursor) break;
            cursor = r2.currentOffset;
          }
          byteOffsetRef.current = Math.max(byteOffsetRef.current, cursor);
        } catch {
          // Session may not exist yet or PTY already exited
        } finally {
          if (!cancelledInitial && termInstanceRef.current === term) {
            if (isVisibleRef.current) {
              // Tile still visible: open the gate so live writes resume.
              dropLiveWritesRef.current = false;
              setTerminalLive(sessionId, true);
            } else {
              // Tile went hidden during the initial replay. Record the
              // current byte offset as the catch-up start so the next reveal
              // queries the right delta (pty.onData kept incrementing
              // byteOffsetRef while the gate dropped writes).
              hiddenAtOffsetRef.current = byteOffsetRef.current;
              setTerminalLive(sessionId, false);
            }
          }
        }
      })();
    }, 0);

    // PTY data → terminal. byteOffsetRef increments unconditionally so it
    // mirrors broker's offset even while we're dropping writes (initial
    // replay / hidden / catching up); dropLiveWritesRef gates whether the
    // chunk reaches xterm.
    const unsubData = subscribeToPtyData(sessionId, (data) => {
      byteOffsetRef.current += utf8ByteLength(data);
      if (dropLiveWritesRef.current) return;
      term.write(data);
    });

    // PTY exit → terminal
    const unsubExit = subscribeToPtyExit(sessionId, ({ code, signal }) => {
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

    // Resize handling. Routed through scheduleRefit (setTimeout(0) + rAF +
    // setTimeout(100) verifyAndCorrectFit) so a single transient-dimension fit
    // can't lock the terminal at stale rows; same backstop the layout-store
    // subscription uses for maximize transitions.
    const resizeObserver = new ResizeObserver(() => { scheduleRefit(); });
    resizeObserver.observe(container);

    // MutationObserver on the terminal panel element catches panel height
    // changes that come via inline-style updates (e.g. terminal_panel_set_height).
    // This fires synchronously on DOM mutations even when Electron is not
    // actively painting, unlike ResizeObserver which requires the rendering loop.
    const panelEl = container.closest('[data-terminal-panel]');
    const mutationObserver = panelEl
      ? new MutationObserver(() => { scheduleRefit(); })
      : null;
    mutationObserver?.observe(panelEl!, { attributes: true, attributeFilter: ['style'] });

    return () => {
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      terminalRegistry.delete(sessionId);
      forgetTerminalFitAddon(sessionId);
      setTerminalLive(sessionId, false);
      cancelledInitial = true;
      clearTimeout(initialFitTimer);
      if (warningTimeoutRef.current !== null) clearTimeout(warningTimeoutRef.current);
      clearSlashWarning(sessionId);
      unsubPreserveScrollback();
      removeEraseSuppression();
      unsubResize.dispose();
      unsubTitle.dispose();
      unsubData();
      unsubExit();
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('focus', focusHandler, true);
      unsubRecreate();
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
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
