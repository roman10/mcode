import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHookBridge } from './hook-bridge';

const BRIDGE_DIR = join(homedir(), '.mcode');
const BRIDGE_SCRIPT_NAME = 'copilot-hook-bridge.sh';

function getBridgeScriptPath(): string {
  return join(BRIDGE_DIR, BRIDGE_SCRIPT_NAME);
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

// --- Pure functions (exported for testing) ---

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

export function mergeMcodeBridgeHooks(config: CopilotHooksConfig): CopilotHooksConfig {
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

// --- Hook bridge instance ---

export const copilotHookBridge = createHookBridge<CopilotHooksConfig>({
  agentName: 'copilot',
  agentTag: 'copilot-hook-config',
  configPath: () => join(homedir(), '.copilot', 'hooks', 'hooks.json'),
  bridgeScriptPath: getBridgeScriptPath,
  bridgeScriptContent: () => `#!/bin/sh
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
`,
  removeHooks: removeMcodeBridgeHooks,
  mergeHooks: mergeMcodeBridgeHooks,
});
