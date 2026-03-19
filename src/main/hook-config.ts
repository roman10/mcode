import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logger } from './logger';
import { KNOWN_HOOK_EVENTS } from '../shared/constants';

const MCODE_HOOK_MARKER = 'X-Mcode-Hook';

interface HookEntry {
  type: string;
  url: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  [key: string]: unknown;
}

interface HookGroup {
  hooks: HookEntry[];
  matcher?: unknown;
  [key: string]: unknown;
}

type HookConfigItem = HookEntry | HookGroup;

interface ClaudeSettings {
  hooks?: Record<string, HookConfigItem[]>;
  allowedHttpHookUrls?: string[];
  [key: string]: unknown;
}

function isMcodeHook(entry: HookEntry): boolean {
  return entry.headers?.[MCODE_HOOK_MARKER] === '1';
}

function isHookGroup(item: HookConfigItem): item is HookGroup {
  return Array.isArray((item as HookGroup).hooks);
}

/** Remove all mcode-owned hook entries from settings. Pure function. */
export function removeMcodeHooks(settings: ClaudeSettings): ClaudeSettings {
  const result = { ...settings };

  if (result.hooks) {
    const newHooks: Record<string, HookConfigItem[]> = {};
    for (const [eventName, entries] of Object.entries(result.hooks)) {
      const filtered = (entries as HookConfigItem[])
        .map((item) => {
          if (isHookGroup(item)) {
            const remainingHooks = item.hooks.filter((hook) => !isMcodeHook(hook));
            if (remainingHooks.length === 0) return null;
            return { ...item, hooks: remainingHooks };
          }
          return isMcodeHook(item) ? null : item;
        })
        .filter((item): item is HookConfigItem => item !== null);
      if (filtered.length > 0) {
        newHooks[eventName] = filtered;
      }
    }
    result.hooks = Object.keys(newHooks).length > 0 ? newHooks : undefined;
  }

  return result;
}

/** Merge mcode hook entries into settings for the given port. Pure function. */
export function mergeMcodeHooks(
  settings: ClaudeSettings,
  port: number,
): ClaudeSettings {
  // Start from a clean slate — remove any stale mcode hooks first
  const result = removeMcodeHooks(settings);

  const hooks = result.hooks ?? {};

  const mcodeEntry: HookEntry = {
    type: 'http',
    url: `http://localhost:${port}/hook`,
    headers: {
      [MCODE_HOOK_MARKER]: '1',
      'X-Mcode-Session-Id': '$MCODE_SESSION_ID',
    },
    allowedEnvVars: ['MCODE_SESSION_ID'],
  };

  for (const eventName of KNOWN_HOOK_EVENTS) {
    const existing = hooks[eventName] ?? [];
    hooks[eventName] = [...existing, { hooks: [{ ...mcodeEntry }] }];
  }

  result.hooks = hooks;

  // Ensure localhost hooks are allowed
  const allowed = new Set(result.allowedHttpHookUrls ?? []);
  allowed.add('http://localhost:*');
  result.allowedHttpHookUrls = [...allowed];

  return result;
}

function getSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}


function reconcileSettingsFile(settingsPath: string, port: number): void {
  // Read existing settings (treat missing file as empty)
  let settings: ClaudeSettings;
  try {
    if (!existsSync(settingsPath)) {
      settings = {};
    } else {
      const raw = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(raw) as ClaudeSettings;
    }
  } catch (err) {
    if (existsSync(settingsPath)) {
      throw new Error(
        `Invalid JSON in ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    settings = {};
  }

  // One-time backup before first mutation
  const backupPath = settingsPath + '.mcode.bak';
  if (existsSync(settingsPath) && !existsSync(backupPath)) {
    copyFileSync(settingsPath, backupPath);
    logger.info('hook-config', 'Created backup', { path: backupPath });
  }

  const updated = mergeMcodeHooks(settings, port);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
}

/** Reconcile ~/.claude/settings.json on app startup. */
export function reconcileOnStartup(port: number, extraSettingsPaths: string[] = []): void {
  const primary = getSettingsPath();
  reconcileSettingsFile(primary, port);

  // Also reconcile hooks for secondary account settings files
  for (const extraPath of extraSettingsPaths) {
    if (extraPath === primary) continue;
    try {
      reconcileSettingsFile(extraPath, port);
    } catch (err) {
      // Non-fatal: secondary account config failures shouldn't block startup
      logger.warn('hook-config', 'Failed to reconcile secondary account settings', {
        path: extraPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('hook-config', 'Reconciled hook config', { port });
}


/** Remove mcode hooks on app quit. */
export function cleanupOnQuit(extraSettingsPaths: string[] = []): void {
  const allPaths = [getSettingsPath(), ...extraSettingsPaths];
  for (const settingsPath of allPaths) {
    try {
      if (!existsSync(settingsPath)) continue;
      const raw = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw) as ClaudeSettings;
      const cleaned = removeMcodeHooks(settings);
      writeFileSync(settingsPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8');
    } catch (err) {
      // Best-effort cleanup — don't crash on quit
      logger.warn('hook-config', 'Failed to clean up hook config', {
        path: settingsPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info('hook-config', 'Cleaned up hook config');
}
