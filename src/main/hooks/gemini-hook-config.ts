import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHookBridge } from './hook-bridge';

const BRIDGE_DIR = join(homedir(), '.mcode');
const BRIDGE_SCRIPT_NAME = 'gemini-hook-bridge.sh';

function getBridgeScriptPath(): string {
  return join(BRIDGE_DIR, BRIDGE_SCRIPT_NAME);
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

const GEMINI_BRIDGE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'BeforeTool',
  'AfterTool',
  'AfterAgent',
  'BeforeAgent',
  'Notification',
  'BeforeModel',
] as const;

function isMcodeBridgeHook(entry: GeminiHookEntry): boolean {
  return entry.command.includes(BRIDGE_SCRIPT_NAME);
}

// --- Pure functions (exported for testing) ---

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

export function mergeMcodeBridgeHooks(config: GeminiSettingsConfig): GeminiSettingsConfig {
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

// --- Hook bridge instance ---

export const geminiHookBridge = createHookBridge<GeminiSettingsConfig>({
  agentName: 'gemini',
  agentTag: 'gemini-hook-config',
  configPath: () => join(homedir(), '.gemini', 'settings.json'),
  bridgeScriptPath: getBridgeScriptPath,
  bridgeScriptContent: () => `#!/bin/sh
# mcode Gemini hook bridge — forwards hook events to mcode's HTTP hook server.
# Non-mcode Gemini sessions (no MCODE_HOOK_PORT) exit silently.
[ -z "$MCODE_HOOK_PORT" ] && printf '{}' && exit 0
curl -sS -o /dev/null "http://localhost:$MCODE_HOOK_PORT/hook" \\
  -H "X-Mcode-Session-Id: $MCODE_SESSION_ID" \\
  -H 'Content-Type: application/json' -d @- 2>/dev/null || true
printf '{}'
`,
  removeHooks: removeMcodeBridgeHooks,
  mergeHooks: mergeMcodeBridgeHooks,
});
