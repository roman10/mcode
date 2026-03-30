import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger';

/** Read a JSON config file, returning `{} as TConfig` if missing. Throws on invalid JSON. */
export function readJsonConfig<TConfig>(path: string): TConfig {
  try {
    if (!existsSync(path)) {
      return {} as TConfig;
    }
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as TConfig;
  } catch (err) {
    if (existsSync(path)) {
      throw new Error(
        `Invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {} as TConfig;
  }
}

/** One-time backup: copy path to path.mcode.bak if backup doesn't exist yet. */
export function backupJsonConfig(path: string, tag: string): void {
  const backupPath = path + '.mcode.bak';
  if (existsSync(path) && !existsSync(backupPath)) {
    copyFileSync(path, backupPath);
    logger.info(tag, 'Created backup', { path: backupPath });
  }
}

/** Write JSON to file with formatting, creating parent dirs as needed. */
export function writeJsonConfig(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** Best-effort cleanup: read → transform → write. Logs warning on failure, never throws. */
export function cleanupJsonConfig<TConfig>(
  path: string,
  tag: string,
  transform: (config: TConfig) => TConfig,
): void {
  try {
    if (!existsSync(path)) return;
    const raw = readFileSync(path, 'utf-8');
    const config = JSON.parse(raw) as TConfig;
    const cleaned = transform(config);
    writeJsonConfig(path, cleaned);
  } catch (err) {
    logger.warn(tag, 'Failed to clean up hooks', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
