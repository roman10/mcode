import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../logger';

// Bridge script path — used as implicit ownership marker (any hook entry
// whose command matches this path is mcode-owned).
const BRIDGE_DIR = join(homedir(), '.mcode');
const BRIDGE_SCRIPT_NAME = 'codex-hook-bridge.sh';

function getBridgeScriptPath(): string {
  return join(BRIDGE_DIR, BRIDGE_SCRIPT_NAME);
}

function getCodexHooksPath(): string {
  return join(homedir(), '.codex', 'hooks.json');
}

// --- Codex hooks.json types ---

interface CodexHookEntry {
  type: string;
  command: string;
  timeout?: number;
  [key: string]: unknown;
}

interface CodexHookGroup {
  matcher?: string | null;
  hooks: CodexHookEntry[];
  [key: string]: unknown;
}

interface CodexHooksConfig {
  hooks?: Record<string, CodexHookGroup[]>;
  [key: string]: unknown;
}

// Events we register bridge hooks for (Codex's supported events
// that map to mcode state machine transitions).
const CODEX_BRIDGE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'UserPromptSubmit',
  'Notification',
] as const;

function isMcodeBridgeHook(entry: CodexHookEntry): boolean {
  return entry.command.includes(BRIDGE_SCRIPT_NAME);
}

// --- Pure functions ---

/** Remove all mcode-owned hook entries from a Codex hooks config. Pure function. */
export function removeMcodeBridgeHooks(config: CodexHooksConfig): CodexHooksConfig {
  const result = { ...config };
  if (!result.hooks) return result;

  const newHooks: Record<string, CodexHookGroup[]> = {};
  for (const [eventName, groups] of Object.entries(result.hooks)) {
    const filtered = groups
      .map((group) => {
        const remaining = group.hooks.filter((h) => !isMcodeBridgeHook(h));
        if (remaining.length === 0) return null;
        return { ...group, hooks: remaining };
      })
      .filter((g): g is CodexHookGroup => g !== null);
    if (filtered.length > 0) {
      newHooks[eventName] = filtered;
    }
  }

  result.hooks = Object.keys(newHooks).length > 0 ? newHooks : undefined;
  return result;
}

/** Add mcode bridge hook entries to a Codex hooks config. Pure function. */
export function mergeMcodeBridgeHooks(config: CodexHooksConfig): CodexHooksConfig {
  // Remove existing mcode hooks first, then add fresh entries
  const result = removeMcodeBridgeHooks(config);
  const hooks = result.hooks ?? {};

  const bridgePath = getBridgeScriptPath();
  const mcodeEntry: CodexHookEntry = {
    type: 'command',
    command: bridgePath,
    timeout: 10,
  };

  for (const eventName of CODEX_BRIDGE_EVENTS) {
    const existing = hooks[eventName] ?? [];
    hooks[eventName] = [...existing, { hooks: [{ ...mcodeEntry }] }];
  }

  result.hooks = hooks;
  return result;
}

// --- File I/O ---

/** Write the bridge shell script to ~/.mcode/codex-hook-bridge.sh. */
export function writeBridgeScript(): string {
  const scriptPath = getBridgeScriptPath();
  const script = `#!/bin/sh
# mcode Codex hook bridge — forwards hook events to mcode's HTTP hook server.
# Non-mcode Codex sessions (no MCODE_HOOK_PORT) exit silently.
[ -z "$MCODE_HOOK_PORT" ] && printf '{}' && exit 0
curl -sS -o /dev/null "http://localhost:$MCODE_HOOK_PORT/hook" \\
  -H "X-Mcode-Session-Id: $MCODE_SESSION_ID" \\
  -H 'Content-Type: application/json' -d @- 2>/dev/null || true
printf '{}'
`;

  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, script, 'utf-8');
  chmodSync(scriptPath, 0o755);

  logger.info('codex-hook-config', 'Wrote bridge script', { path: scriptPath });
  return scriptPath;
}

/** Reconcile ~/.codex/hooks.json on app startup. */
export function reconcileCodexHooks(): void {
  const hooksPath = getCodexHooksPath();

  let config: CodexHooksConfig;
  try {
    if (!existsSync(hooksPath)) {
      config = {};
    } else {
      const raw = readFileSync(hooksPath, 'utf-8');
      config = JSON.parse(raw) as CodexHooksConfig;
    }
  } catch (err) {
    if (existsSync(hooksPath)) {
      throw new Error(
        `Invalid JSON in ${hooksPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    config = {};
  }

  // One-time backup before first mutation
  const backupPath = hooksPath + '.mcode.bak';
  if (existsSync(hooksPath) && !existsSync(backupPath)) {
    copyFileSync(hooksPath, backupPath);
    logger.info('codex-hook-config', 'Created backup', { path: backupPath });
  }

  const updated = mergeMcodeBridgeHooks(config);
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');

  logger.info('codex-hook-config', 'Reconciled Codex hooks', { path: hooksPath });
}

/** Remove mcode bridge hooks from ~/.codex/hooks.json on app quit. */
export function cleanupCodexHooks(): void {
  const hooksPath = getCodexHooksPath();
  try {
    if (!existsSync(hooksPath)) return;
    const raw = readFileSync(hooksPath, 'utf-8');
    const config = JSON.parse(raw) as CodexHooksConfig;
    const cleaned = removeMcodeBridgeHooks(config);
    writeFileSync(hooksPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8');
    logger.info('codex-hook-config', 'Cleaned up Codex hooks');
  } catch (err) {
    // Best-effort cleanup — don't crash on quit
    logger.warn('codex-hook-config', 'Failed to clean up Codex hooks', {
      path: hooksPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
