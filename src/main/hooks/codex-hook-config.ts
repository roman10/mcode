import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHookBridge } from './hook-bridge';

const BRIDGE_DIR = join(homedir(), '.mcode');
const BRIDGE_SCRIPT_NAME = 'codex-hook-bridge.sh';

function getBridgeScriptPath(): string {
  return join(BRIDGE_DIR, BRIDGE_SCRIPT_NAME);
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

// --- Pure functions (exported for testing) ---

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

export function mergeMcodeBridgeHooks(config: CodexHooksConfig): CodexHooksConfig {
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

// --- Hook bridge instance ---

export const codexHookBridge = createHookBridge<CodexHooksConfig>({
  agentName: 'codex',
  agentTag: 'codex-hook-config',
  configPath: () => join(homedir(), '.codex', 'hooks.json'),
  bridgeScriptPath: getBridgeScriptPath,
  bridgeScriptContent: () => `#!/bin/sh
# mcode Codex hook bridge — forwards hook events to mcode's HTTP hook server.
# Non-mcode Codex sessions (no MCODE_HOOK_PORT) exit silently.
[ -z "$MCODE_HOOK_PORT" ] && printf '{}' && exit 0
curl -sS -o /dev/null "http://localhost:$MCODE_HOOK_PORT/hook" \\
  -H "X-Mcode-Session-Id: $MCODE_SESSION_ID" \\
  -H 'Content-Type: application/json' -d @- 2>/dev/null || true
printf '{}'
`,
  removeHooks: removeMcodeBridgeHooks,
  mergeHooks: mergeMcodeBridgeHooks,
});
