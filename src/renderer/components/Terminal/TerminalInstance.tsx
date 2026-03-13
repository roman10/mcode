import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { darkTheme } from '../../styles/theme';
import { TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY } from '../../../shared/constants';

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

    // WebGL addon must load AFTER term.open() (requires DOM attachment)
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed, falling back to canvas renderer:', e);
    }

    fitAddon.fit();

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
