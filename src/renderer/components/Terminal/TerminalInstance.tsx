import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { darkTheme } from '../../styles/theme';
import { TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY } from '../../../shared/constants';
import { terminalRegistry } from '../../devtools/terminal-registry';

interface TerminalInstanceProps {
  sessionId: string;
}

function TerminalInstance({ sessionId }: TerminalInstanceProps): React.JSX.Element {
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: darkTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

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

    fitAddon.fit();

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

    // Resize handling with rAF debounce
    let resizeRaf = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        fitAddon.fit();
        if (term.cols > 0 && term.rows > 0) {
          window.mcode.pty.resize(sessionId, term.cols, term.rows);
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      terminalRegistry.delete(sessionId);
      cancelAnimationFrame(resizeRaf);
      unsubData();
      unsubExit();
      resizeObserver.disconnect();
      webglAddon?.dispose();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />;
}

export default TerminalInstance;
