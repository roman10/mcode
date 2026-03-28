import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../logger';

// Bridge script path — used as implicit ownership marker (any hook entry
// whose command matches this path is mcode-owned).
const BRIDGE_DIR = join(homedir(), '.mcode');
const BRIDGE_SCRIPT_NAME = 'gemini-hook-bridge.sh';

function getBridgeScriptPath(): string {
  return join(BRIDGE_DIR, BRIDGE_SCRIPT_NAME);
}

function getGeminiSettingsPath(): string {
  return join(homedir(), '.gemini', 'settings.json');
}

// --- Gemini settings.json types ---

interface GeminiHookEntry {
  type: string;
  command: string;
  name?: string;
  timeout?: number;
  [key: string]: unknown;
}

interface GeminiHookGroup {
  matcher?: string;
  hooks: GeminiHookEntry[];
  [key: string]: unknown;
}

interface GeminiSettingsConfig {
  hooks?: Record<string, GeminiHookGroup[]>;
  [key: string]: unknown;
}

// Events we register bridge hooks for. These use Gemini's native names —
// the hook server normalizes them to mcode's canonical names on receipt.
const GEMINI_BRIDGE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'BeforeTool',
  'AfterTool',
  'AfterAgent',
  'BeforeAgent',
  'Notification',
] as const;

function isMcodeBridgeHook(entry: GeminiHookEntry): boolean {
  return entry.command.includes(BRIDGE_SCRIPT_NAME);
}

// --- Pure functions ---

/** Remove all mcode-owned hook entries from a Gemini settings config. Pure function. */
export function removeMcodeBridgeHooks(config: GeminiSettingsConfig): GeminiSettingsConfig {
  const result = { ...config };
  if (!result.hooks) return result;

  const newHooks: Record<string, GeminiHookGroup[]> = {};
  for (const [eventName, groups] of Object.entries(result.hooks)) {
    const filtered = groups
      .map((group) => {
        const remaining = group.hooks.filter((h) => !isMcodeBridgeHook(h));
        if (remaining.length === 0) return null;
        return { ...group, hooks: remaining };
      })
      .filter((g): g is GeminiHookGroup => g !== null);
    if (filtered.length > 0) {
      newHooks[eventName] = filtered;
    }
  }

  result.hooks = Object.keys(newHooks).length > 0 ? newHooks : undefined;
  return result;
}

/** Add mcode bridge hook entries to a Gemini settings config. Pure function. */
export function mergeMcodeBridgeHooks(config: GeminiSettingsConfig): GeminiSettingsConfig {
  // Remove existing mcode hooks first, then add fresh entries
  const result = removeMcodeBridgeHooks(config);
  const hooks = result.hooks ?? {};

  const bridgePath = getBridgeScriptPath();
  const mcodeEntry: GeminiHookEntry = {
    type: 'command',
    command: bridgePath,
    name: 'mcode-bridge',
    timeout: 10000,
  };

  for (const eventName of GEMINI_BRIDGE_EVENTS) {
    const existing = hooks[eventName] ?? [];
    hooks[eventName] = [...existing, { matcher: '*', hooks: [{ ...mcodeEntry }] }];
  }

  result.hooks = hooks;
  return result;
}

// --- File I/O ---

/** Write the bridge shell script to ~/.mcode/gemini-hook-bridge.sh. */
export function writeGeminiBridgeScript(): string {
  const scriptPath = getBridgeScriptPath();
  const script = `#!/bin/sh
# mcode Gemini hook bridge — forwards hook events to mcode's HTTP hook server.
# Non-mcode Gemini sessions (no MCODE_HOOK_PORT) exit silently.
[ -z "$MCODE_HOOK_PORT" ] && printf '{}' && exit 0
curl -sS -o /dev/null "http://localhost:$MCODE_HOOK_PORT/hook" \\
  -H "X-Mcode-Session-Id: $MCODE_SESSION_ID" \\
  -H 'Content-Type: application/json' -d @- 2>/dev/null || true
printf '{}'
`;

  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, script, 'utf-8');
  chmodSync(scriptPath, 0o755);

  logger.info('gemini-hook-config', 'Wrote bridge script', { path: scriptPath });
  return scriptPath;
}

/** Reconcile ~/.gemini/settings.json on app startup. */
export function reconcileGeminiHooks(): void {
  const settingsPath = getGeminiSettingsPath();

  let config: GeminiSettingsConfig;
  try {
    if (!existsSync(settingsPath)) {
      config = {};
    } else {
      const raw = readFileSync(settingsPath, 'utf-8');
      config = JSON.parse(raw) as GeminiSettingsConfig;
    }
  } catch (err) {
    if (existsSync(settingsPath)) {
      throw new Error(
        `Invalid JSON in ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    config = {};
  }

  // One-time backup before first mutation
  const backupPath = settingsPath + '.mcode.bak';
  if (existsSync(settingsPath) && !existsSync(backupPath)) {
    copyFileSync(settingsPath, backupPath);
    logger.info('gemini-hook-config', 'Created backup', { path: backupPath });
  }

  const updated = mergeMcodeBridgeHooks(config);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');

  logger.info('gemini-hook-config', 'Reconciled Gemini hooks', { path: settingsPath });
}

/** Remove mcode bridge hooks from ~/.gemini/settings.json on app quit. */
export function cleanupGeminiHooks(): void {
  const settingsPath = getGeminiSettingsPath();
  try {
    if (!existsSync(settingsPath)) return;
    const raw = readFileSync(settingsPath, 'utf-8');
    const config = JSON.parse(raw) as GeminiSettingsConfig;
    const cleaned = removeMcodeBridgeHooks(config);
    writeFileSync(settingsPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8');
    logger.info('gemini-hook-config', 'Cleaned up Gemini hooks');
  } catch (err) {
    // Best-effort cleanup — don't crash on quit
    logger.warn('gemini-hook-config', 'Failed to clean up Gemini hooks', {
      path: settingsPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
