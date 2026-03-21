# Session Persistence: Design Exploration

## Problem

When mcode closes, all Claude Code and terminal sessions are killed. The Electron `before-quit` handler calls `killAll()` (explicit SIGTERM → SIGKILL) and `endAllActive()`. Even without `killAll()`, simply closing the PTY master fd (held by `PtyManager`) causes the kernel to send **SIGHUP** to the Claude Code process — which terminates it by default. So "just don't call kill()" doesn't work.

### What's Actually Lost

- **Conversation history**: NOT lost. Claude Code writes all messages/tool calls incrementally to `~/.claude/projects/[hash]/[session].jsonl`. This survives regardless.
- **Current in-flight turn**: Lost. If Claude is mid-task, that turn's partial output is gone.
- **Live terminal view**: Lost. The PTY is gone.

### What Already Works

- `--resume <claudeSessionId>` restarts Claude Code from its last JSONL checkpoint (already implemented in mcode via `SessionManager.resume()`)
- `session.listExternal()` can discover Claude sessions not tracked by mcode (reads JSONL files from `~/.claude/projects/`)

---

## Why Simple "Orphan" Doesn't Work

The PTY master fd lives inside mcode's `PtyManager`. When Electron quits, all fds close. The kernel then delivers SIGHUP to Claude Code (running in the PTY slave). Node.js processes exit on SIGHUP by default. Claude Code dies before it finishes writing.

---

## Options Evaluated

### Option A: Warning dialog on close
Show "X sessions are running, are you sure?" before quitting.

- Effort: hours
- Solves: accidental closes
- Doesn't solve: intentional "close but keep running"

### Option B: `nohup` spawn (no PTY)
Spawn Claude Code with `stdio: 'pipe'` and SIGHUP immunity. No PTY master fd means no SIGHUP problem.

- Effort: days
- Pros: Claude Code survives mcode closing; full JSONL history readable on reopen
- Cons: No terminal colors, no interactivity, no live xterm.js view while running. Fundamentally breaks the terminal UX.

### Option C: PTY Broker (mini-daemon) — Recommended
A tiny detached process whose **only job is holding PTY master file descriptors**. Electron stays the "real" process (owns DB, hooks, business logic). The broker is a relay layer, not a full server.

### Option D: Full Daemon
Move everything (DB, hooks, session management, task queue) into a background daemon. Electron becomes a thin UI client.

---

## Recommended Approach: PTY Broker

### Why Not the Full Daemon

The full daemon is the correct long-term architecture if mcode needs multi-window, remote access, or CLI control. But it's a weeks-long refactor of every service, with significant operational complexity (version mismatches on upgrade, zombie daemons, harder debugging). For a pre-release product, the cost/benefit is poor.

### Why PTY Broker Is Better Right Now

The root cause of session death is one thing: **the PTY master fd closing**. Solve only that. Keep everything else in Electron.

### Architecture

```
[PTY Broker — tiny detached process]  ←── Unix socket ───  [Electron app — unchanged otherwise]
  - PTY master fds (one per session)                          - DB, hooks, session management
  - Ring buffer per session (~100KB)                          - Task queue, commit tracker, etc.
  - Input relay (client writes → PTY)                        - Connects to broker on open
  - Output relay (PTY data → all clients)                    - Disconnects on quit (broker stays up)
  - Spawns new PTYs on request
```

When Electron quits:
- Broker stays running → PTY master fds stay open → no SIGHUP → Claude Code keeps running
- Hook server dies (Claude Code hooks get connection refused — silently ignored, Claude continues)
- DB session status stops updating (session stays "active" in DB — or marked "detached" before disconnect)
- Claude Code keeps writing JSONL

When Electron reopens:
- Connect to broker via Unix socket
- Ask broker: which sessions are still alive? (broker tracks PIDs + session IDs)
- Match against DB records
- Show live terminal for reconnectable sessions (ring buffer replay + stream)
- Sessions that finished while detached: visible via JSONL history / resume

### What the Broker Does NOT Own

- SQLite (stays in Electron)
- Hook HTTP server (stays in Electron — dies when app closes, acceptable)
- Session metadata (stays in Electron's SessionManager)
- Task queue, commit tracker, token tracker (all stay in Electron)

### Broker Protocol (Unix socket, JSON-Lines)

```
Client → Broker:  {"id":"uuid","method":"pty.spawn","params":{"sessionId":"...","cmd":"...","env":{...}}}\n
Client → Broker:  {"id":"uuid","method":"pty.list"}\n            → returns [{sessionId, pid, alive}]
Client → Broker:  {"method":"pty.write","params":{"id":"...","data":"..."}}\n   (fire-and-forget)
Client → Broker:  {"id":"uuid","method":"pty.replay","params":{"id":"..."}}\n   → returns buffered string
Client → Broker:  {"id":"uuid","method":"pty.kill","params":{"id":"..."}}\n
Client → Broker:  {"id":"uuid","method":"broker.shutdown"}\n     → kills all PTYs, exits

Broker → Client:  {"event":"pty.data","params":{"id":"...","data":"..."}}\n     (push, streaming)
Broker → Client:  {"event":"pty.exit","params":{"id":"...","code":0}}\n
Broker → Client:  {"event":"broker.hello","params":{"version":"1","pid":12345}}\n
```

### Spawning Strategy

Same approach as the full daemon: pass `--pty-broker` flag to the Electron binary. Detected at the top of `src/main/index.ts` before `app.whenReady()` does real work. `app.dock?.hide()`, no window created. Works with `hardenedRuntime: true` (no `ELECTRON_RUN_AS_NODE` needed).

```
spawn(process.execPath, ['--pty-broker', socketPath], { detached: true, stdio: 'ignore' })
child.unref()
```

### New Files (minimal)

| File | Purpose |
|------|---------|
| `src/broker/index.ts` | `runBroker(socketPath)` — starts Unix socket server, manages PTY fds, ring buffers |
| `src/main/broker-client.ts` | `BrokerClient` — thin wrapper replacing direct `PtyManager` calls for spawn/write/resize/kill/replay |
| `src/main/broker-launcher.ts` | `ensureBroker(socketPath)` — health check + spawn if needed |

### Modified Files

| File | Change |
|------|--------|
| `src/main/index.ts` | Add `--pty-broker` branch; replace `ptyManager.*` calls with `brokerClient.*`; change `before-quit` to disconnect (not kill) |
| `src/main/pty-manager.ts` | Largely replaced by `BrokerClient` in the Electron process; broker runs its own copy of the PTY logic |
| `src/main/session-manager.ts` | On quit: mark running sessions as "detached" (new status) instead of "ended" |
| `electron.vite.config.ts` | Add `broker` as second rollup entry → `out/main/broker.js` |

### New Session Status: `detached`

Add `'detached'` to the session status enum. Meaning: "mcode closed while this session was running; the PTY may still be alive in the broker." On reconnect, mcode checks the broker for still-alive PTYs and transitions `detached → active` or `detached → ended` accordingly.

### Trade-offs vs Full Daemon

| | PTY Broker | Full Daemon |
|---|---|---|
| Effort | ~1 week | 3-4 weeks |
| Hook events while detached | Lost | Preserved |
| Task queue while detached | Paused | Continues |
| DB session status while detached | Stale (detached) | Live |
| Upgrade complexity | Low (broker is tiny) | High (protocol versioning) |
| Debugging | Easy (broker is simple) | Hard |
| Future extensibility | Good stepping stone | Full solution |

### Acceptable Limitations (for now)

- **Hooks die with Electron**: Claude Code gets connection refused on its hook calls. It logs a warning but continues. Status updates (attention level, tool events) stop while detached. Acceptable — the task is still running.
- **Task queue pauses**: Queued tasks won't dispatch while mcode is closed. Acceptable for the current use case.
- **No hook history while detached**: Events during detached period not recorded. Acceptable.

---

## JSONL History on Reopen

Yes — Claude Code writes to its JSONL file incrementally throughout execution. When mcode reopens:
1. For sessions still running in the broker: show live terminal (ring buffer replay + stream)
2. For sessions that finished while detached: `session.listExternal()` can discover them via JSONL; `--resume` lets you continue the conversation

The JSONL read-back path is already implemented. The only new piece is detecting which sessions are still alive in the broker.

---

## Implementation Sequence

1. Add `detached` session status to DB schema + SessionManager
2. Build `src/broker/index.ts` — PTY management + Unix socket server (extracted from PtyManager)
3. Build `src/main/broker-client.ts` — replaces direct PtyManager usage in Electron main
4. Build `src/main/broker-launcher.ts` — spawn + health check
5. Add `--pty-broker` branch to `src/main/index.ts`
6. Change `before-quit`: mark running sessions as `detached`, disconnect from broker (no kill)
7. On app open: reconnect to broker, reconcile `detached` sessions (still alive → `active`, gone → `ended`)
8. Update build config: add `broker` rollup entry

---

## Verification

```bash
npm run dev
# 1. Start a Claude session, let it run
# 2. Quit mcode (Cmd+Q)
# 3. Verify Claude Code still running: ps aux | grep claude
# 4. Verify JSONL being written: ls -la ~/.claude/projects/
# 5. Reopen mcode — session shows live terminal with replay
# 6. Verify "Quit and Kill All Sessions" terminates Claude Code and broker
# 7. Test broker crash: kill broker PID → reopen mcode → broker respawns, sessions gone but app works
```
