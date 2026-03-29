import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../logger';

// Bridge script path — used as implicit ownership marker (any hook entry
// whose bash field matches this path is mcode-owned).
const BRIDGE_DIR = join(homedir(), '.mcode');
const BRIDGE_SCRIPT_NAME = 'copilot-hook-bridge.sh';

function getBridgeScriptPath(): string {
  return join(BRIDGE_DIR, BRIDGE_SCRIPT_NAME);
}

function getCopilotHooksPath(): string {
  return join(homedir(), '.copilot', 'hooks', 'hooks.json');
}

// --- Copilot hooks.json types ---

interface CopilotHookEntry {
  type: string;
  bash: string;
  powershell?: string;
  cwd?: string;
  timeoutSec?: number;
  env?: Record<string, string>;
  comment?: string;
  [key: string]: unknown;
}

interface CopilotHooksConfig {
  version?: number;
  hooks?: Record<string, CopilotHookEntry[]>;
  [key: string]: unknown;
}

// Events we register bridge hooks for (Copilot's native camelCase names).
const COPILOT_BRIDGE_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'userPromptSubmitted',
  'errorOccurred',
] as const;

function isMcodeBridgeHook(entry: CopilotHookEntry): boolean {
  return entry.bash.includes(BRIDGE_SCRIPT_NAME);
}

// --- Pure functions ---

/** Remove all mcode-owned hook entries from a Copilot hooks config. Pure function. */
export function removeMcodeBridgeHooks(config: CopilotHooksConfig): CopilotHooksConfig {
  const result = { ...config };
  if (!result.hooks) return result;

  const newHooks: Record<string, CopilotHookEntry[]> = {};
  for (const [eventName, entries] of Object.entries(result.hooks)) {
    const filtered = entries.filter((h) => !isMcodeBridgeHook(h));
    if (filtered.length > 0) {
      newHooks[eventName] = filtered;
    }
  }

  result.hooks = Object.keys(newHooks).length > 0 ? newHooks : undefined;
  return result;
}

/** Add mcode bridge hook entries to a Copilot hooks config. Pure function. */
export function mergeMcodeBridgeHooks(config: CopilotHooksConfig): CopilotHooksConfig {
  // Remove existing mcode hooks first, then add fresh entries
  const result = removeMcodeBridgeHooks(config);
  const hooks = result.hooks ?? {};

  const bridgePath = getBridgeScriptPath();

  for (const eventName of COPILOT_BRIDGE_EVENTS) {
    const existing = hooks[eventName] ?? [];
    const mcodeEntry: CopilotHookEntry = {
      type: 'command',
      bash: bridgePath,
      timeoutSec: 10,
      env: { COPILOT_HOOK_EVENT: eventName },
    };
    hooks[eventName] = [...existing, mcodeEntry];
  }

  result.version = result.version ?? 1;
  result.hooks = hooks;
  return result;
}

// --- File I/O ---

/** Write the bridge shell script to ~/.mcode/copilot-hook-bridge.sh. */
export function writeCopilotBridgeScript(): string {
  const scriptPath = getBridgeScriptPath();
  const script = `#!/bin/sh
# mcode Copilot hook bridge — forwards hook events to mcode's HTTP hook server.
# Non-mcode Copilot sessions (no MCODE_HOOK_PORT) exit silently.
[ -z "$MCODE_HOOK_PORT" ] && printf '{}' && exit 0
# Copilot payloads lack hook_event_name — inject it from $COPILOT_HOOK_EVENT
# (set per-event via the "env" field in hooks.json).
INPUT=$(cat)
printf '%s' "$INPUT" | sed 's/^{/{"hook_event_name":"'"$COPILOT_HOOK_EVENT"'",/' | \\
curl -sS -o /dev/null "http://localhost:$MCODE_HOOK_PORT/hook" \\
  -H "X-Mcode-Session-Id: $MCODE_SESSION_ID" \\
  -H 'Content-Type: application/json' -d @- 2>/dev/null || true
printf '{}'
`;

  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, script, 'utf-8');
  chmodSync(scriptPath, 0o755);

  logger.info('copilot-hook-config', 'Wrote bridge script', { path: scriptPath });
  return scriptPath;
}

/** Reconcile ~/.copilot/hooks/hooks.json on app startup. */
export function reconcileCopilotHooks(): void {
  const hooksPath = getCopilotHooksPath();

  let config: CopilotHooksConfig;
  try {
    if (!existsSync(hooksPath)) {
      config = {};
    } else {
      const raw = readFileSync(hooksPath, 'utf-8');
      config = JSON.parse(raw) as CopilotHooksConfig;
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
    logger.info('copilot-hook-config', 'Created backup', { path: backupPath });
  }

  const updated = mergeMcodeBridgeHooks(config);
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');

  logger.info('copilot-hook-config', 'Reconciled Copilot hooks', { path: hooksPath });
}

/** Remove mcode bridge hooks from ~/.copilot/hooks/hooks.json on app quit. */
export function cleanupCopilotHooks(): void {
  const hooksPath = getCopilotHooksPath();
  try {
    if (!existsSync(hooksPath)) return;
    const raw = readFileSync(hooksPath, 'utf-8');
    const config = JSON.parse(raw) as CopilotHooksConfig;
    const cleaned = removeMcodeBridgeHooks(config);
    writeFileSync(hooksPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8');
    logger.info('copilot-hook-config', 'Cleaned up Copilot hooks');
  } catch (err) {
    // Best-effort cleanup — don't crash on quit
    logger.warn('copilot-hook-config', 'Failed to clean up Copilot hooks', {
      path: hooksPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
