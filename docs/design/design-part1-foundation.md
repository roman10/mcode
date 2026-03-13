# mcode — Part 1: Foundation

> **Phases covered:** 1 (Skeleton App) + 2 (Single Terminal)
> **Prerequisites:** None — this is the starting point
> **Outcome:** Electron app with a single interactive PTY terminal rendered via xterm.js
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Project Structure (initial)

```
mcode/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
│
├── resources/
│   └── icon.icns
│
├── src/
│   ├── shared/
│   │   ├── types.ts              # PtySpawnOptions, MCodeAPI (pty subset)
│   │   └── constants.ts          # Default config values
│   │
│   ├── main/
│   │   ├── index.ts              # App entry, window creation
│   │   └── pty-manager.ts        # PTY lifecycle + IPC handlers
│   │
│   ├── preload/
│   │   └── index.ts              # contextBridge for PTY channels
│   │
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx               # Full-screen terminal (Phase 2)
│       │
│       ├── components/
│       │   └── Terminal/
│       │       └── TerminalInstance.tsx
│       │
│       └── styles/
│           ├── global.css        # Tailwind v4 entry (@import "tailwindcss", @theme tokens)
│           └── theme.ts          # Color tokens
```

### PTY Manager (`pty-manager.ts`)

```typescript
interface PtyHandle {
  id: string;                    // UUID
  process: IPty;                 // node-pty process
  cols: number;
  rows: number;
}

class PtyManager {
  private ptys: Map<string, PtyHandle>;

  spawn(options: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
    args?: string[];
    env?: Record<string, string>;
  }): PtyHandle;

  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): Promise<void>;
  list(): string[];
}
```

**Key behaviors:**
- Spawns processes with the user's default shell environment
- Listens to `process.onData` and forwards output to renderer via IPC
- Listens to `process.onExit` and notifies renderer

**IPC channels (main → renderer):**
- `pty:data` — terminal output bytes
- `pty:exit` — process exit code/signal

**IPC channels (renderer → main):**
- `pty:spawn` — create new PTY
- `pty:write` — send keystrokes
- `pty:resize` — update dimensions
- `pty:kill` — terminate session

### IPC Bridge (preload)

```typescript
// Subset of MCodeAPI needed for this part
interface MCodeAPI {
  pty: {
    spawn(options: PtySpawnOptions): Promise<string>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, code: number) => void): () => void;
  };
}
```

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('mcode', {
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('pty:kill', id),
    onData: (cb) => {
      const handler = (_e, id, data) => cb(id, data);
      ipcRenderer.on('pty:data', handler);
      return () => ipcRenderer.removeListener('pty:data', handler);
    },
    onExit: (cb) => {
      const handler = (_e, id, code) => cb(id, code);
      ipcRenderer.on('pty:exit', handler);
      return () => ipcRenderer.removeListener('pty:exit', handler);
    },
  },
});
```

### Terminal Instance Component

```typescript
function TerminalInstance({ sessionId }: { sessionId: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: darkTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webglAddon = new WebglAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webglAddon);
    term.loadAddon(webLinksAddon);

    term.open(termRef.current!);
    fitAddon.fit();

    const unsubData = window.mcode.pty.onData((id, data) => {
      if (id === sessionId) term.write(data);
    });

    term.onData((data) => {
      window.mcode.pty.write(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.mcode.pty.resize(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(termRef.current!);

    xtermRef.current = term;

    return () => {
      unsubData();
      resizeObserver.disconnect();
      webglAddon.dispose();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />;
}
```

**Imports use `@xterm/xterm`** (not legacy `xterm` package): `import { Terminal } from '@xterm/xterm'`, `import { FitAddon } from '@xterm/addon-fit'`, etc.

### Theming

```typescript
const theme = {
  bg: {
    primary: '#0d1117',
    secondary: '#161b22',
    elevated: '#1c2128',
    terminal: '#000000',
  },
  border: {
    default: '#30363d',
    focus: '#58a6ff',
  },
  text: {
    primary: '#e6edf3',
    secondary: '#8b949e',
    muted: '#484f58',
  },
  accent: '#58a6ff',
};
```

- **UI text:** Inter or system font, 13px base
- **Terminal:** JetBrains Mono, 13px, ligatures disabled

### Build Config

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty', 'better-sqlite3'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
```

### Dependencies

```json
{
  "dependencies": {
    "node-pty": "^1.1.0",
    "@xterm/xterm": "^6.0.0",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-webgl": "^0.19.0",
    "@xterm/addon-web-links": "^0.12.0",
    "better-sqlite3": "^12.6.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "electron-log": "^5.4.0"
  },
  "devDependencies": {
    "electron": "^41.0.0",
    "electron-vite": "^5.0.0",
    "electron-builder": "^26.8.0",
    "@electron/rebuild": "^4.0.0",
    "typescript": "^5.9.0",
    "@vitejs/plugin-react": "^6.0.0",
    "vite": "^8.0.0",
    "tailwindcss": "^4.2.0",
    "@tailwindcss/vite": "^4.2.0"
  }
}
```

> `better-sqlite3` is included now so `electron-rebuild` is validated against both native modules. It isn't used until Part 2 (sessions).

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| **node-pty spawn** | `claude` not found in PATH | Show error in tile. Session → `ended`. |
| **node-pty spawn** | cwd doesn't exist | Show dialog before spawning. Reject with clear message. |
| **PTY crash** | Process exits unexpectedly | Show exit code/signal in UI. |

### Security

- **Context isolation:** Enabled
- **Node integration in renderer:** Disabled
- **Preload script:** Minimal surface — only PTY IPC methods
- **No remote module**
- **CSP:** Strict Content-Security-Policy (no eval, no inline scripts)

### Performance Targets

| Metric | Target |
|---|---|
| App startup to interactive | < 2 seconds |
| Terminal input latency | < 16ms (one frame) |
| Terminal rendering at full scroll | 60fps via WebGL |

---

## Phase 1: Skeleton App

**Goal:** Electron app launches, renders a React page with HMR, native modules compile.

**Build:**
- `electron-vite` project scaffolding with main/preload/renderer
- Tailwind CSS v4 configured in renderer via `@tailwindcss/vite` plugin (CSS-based config, no `tailwind.config.ts`)
- `node-pty` and `better-sqlite3` added as dependencies, `electron-rebuild` configured
- TypeScript strict mode across all three process targets
- `npm run dev` launches Electron with HMR for the renderer
- `src/shared/types.ts` with initial type stubs

**Verify:**
1. `npm run dev` opens an Electron window showing a React page with styled text
2. `npm run typecheck` passes with zero errors
3. No console errors in Electron DevTools
4. Changing a React component hot-reloads without restarting the app

**Files created:** `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/global.css` (Tailwind v4 uses CSS-based config via `@theme` directives, no `tailwind.config.ts`), `src/shared/types.ts`, `src/shared/constants.ts`

---

## Phase 2: Single Terminal

**Goal:** Spawn a real PTY, render it with xterm.js, type into it, see output. This validates the critical technical path: node-pty → IPC → xterm.js.

**Build:**
- `PtyManager` class: `spawn()`, `write()`, `resize()`, `kill()`
- IPC bridge for PTY channels (preload exposes `window.mcode.pty`)
- `TerminalInstance` React component with xterm.js + fit addon + WebGL addon
- App.tsx renders a single full-screen `TerminalInstance`
- On launch, auto-spawns one PTY running the user's default shell

**Verify:**
1. App launches → terminal appears → shows shell prompt (zsh/bash)
2. Type `ls` + Enter → see directory listing with correct colors
3. Run `vim` or `htop` → TUI renders correctly (tests ANSI, cursor, alternate screen)
4. Resize the window → terminal reflows text correctly (fit addon + PTY resize)
5. `Cmd+C` sends interrupt to running process
6. Close window → PTY process is killed (check with `ps`)

**Files created:** `src/main/pty-manager.ts`, `src/renderer/components/Terminal/TerminalInstance.tsx`
**Files modified:** `src/preload/index.ts`, `src/shared/types.ts`, `src/main/index.ts`, `src/renderer/App.tsx`
