import { existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger';
import { readJsonConfig, backupJsonConfig, writeJsonConfig, cleanupJsonConfig } from './hook-config-io';

/**
 * Describes an agent's hook bridge configuration.
 * Each bridge-script agent provides its paths, script content, and pure transform functions.
 */
export interface HookBridgeDescriptor<TConfig> {
  /** Agent name used in index.ts and hookBridgeReady map, e.g. 'codex' */
  agentName: string;
  /** Logger tag, e.g. 'codex-hook-config' */
  agentTag: string;
  /** Absolute path to the agent's hook config file */
  configPath: () => string;
  /** Absolute path to the bridge script */
  bridgeScriptPath: () => string;
  /** Shell script content */
  bridgeScriptContent: () => string;
  /** Remove all mcode-owned entries. Pure function. */
  removeHooks: (config: TConfig) => TConfig;
  /** Add mcode bridge entries (calls removeHooks internally). Pure function. */
  mergeHooks: (config: TConfig) => TConfig;
}

/**
 * Returned by createHookBridge(). Provides the file I/O lifecycle
 * for a bridge-script agent's hook configuration.
 */
export interface HookBridge {
  /** Write the bridge shell script to ~/.mcode/<agent>-hook-bridge.sh */
  writeBridgeScript: () => string;
  /** Read config → backup → detect stale → merge → write */
  reconcile: () => void;
  /** Read config → remove mcode entries → write (best-effort) */
  cleanup: () => void;
  /** Agent name for logging and hookBridgeReady map */
  readonly agentName: string;
}

export function createHookBridge<TConfig>(desc: HookBridgeDescriptor<TConfig>): HookBridge {
  return {
    agentName: desc.agentName,

    writeBridgeScript(): string {
      const scriptPath = desc.bridgeScriptPath();
      mkdirSync(dirname(scriptPath), { recursive: true });
      writeFileSync(scriptPath, desc.bridgeScriptContent(), 'utf-8');
      chmodSync(scriptPath, 0o755);
      logger.info(desc.agentTag, 'Wrote bridge script', { path: scriptPath });
      return scriptPath;
    },

    reconcile(): void {
      const scriptPath = desc.bridgeScriptPath();
      if (!existsSync(scriptPath)) {
        logger.warn(desc.agentTag, 'Bridge script not found, skipping reconcile', { path: scriptPath });
        return;
      }

      const configPath = desc.configPath();
      const config = readJsonConfig<TConfig>(configPath);
      backupJsonConfig(configPath, desc.agentTag);

      // Detect stale mcode hooks (informational logging)
      const cleaned = desc.removeHooks(config);
      if (JSON.stringify(cleaned) !== JSON.stringify(config)) {
        logger.info(desc.agentTag, 'Removed stale mcode bridge hooks before re-registering');
      }

      const updated = desc.mergeHooks(config);
      writeJsonConfig(configPath, updated);
      logger.info(desc.agentTag, `Reconciled ${desc.agentName} hooks`, { path: configPath });
    },

    cleanup(): void {
      cleanupJsonConfig<TConfig>(desc.configPath(), desc.agentTag, desc.removeHooks);
    },
  };
}
