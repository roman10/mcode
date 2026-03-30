import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readJsonConfig,
  backupJsonConfig,
  writeJsonConfig,
  cleanupJsonConfig,
} from '../../../src/main/hooks/hook-config-io';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hook-config-io-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('readJsonConfig', () => {
  it('returns {} when file does not exist', () => {
    const result = readJsonConfig(join(tempDir, 'missing.json'));
    expect(result).toEqual({});
  });

  it('reads valid JSON file', () => {
    const filePath = join(tempDir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ key: 'value', nested: { a: 1 } }));
    const result = readJsonConfig<{ key: string; nested: { a: number } }>(filePath);
    expect(result).toEqual({ key: 'value', nested: { a: 1 } });
  });

  it('throws on invalid JSON when file exists', () => {
    const filePath = join(tempDir, 'bad.json');
    writeFileSync(filePath, 'not json{{{');
    expect(() => readJsonConfig(filePath)).toThrow(/Invalid JSON in/);
    expect(() => readJsonConfig(filePath)).toThrow(filePath);
  });
});

describe('backupJsonConfig', () => {
  it('creates .mcode.bak backup when file exists and backup does not', () => {
    const filePath = join(tempDir, 'config.json');
    writeFileSync(filePath, '{"original": true}');

    backupJsonConfig(filePath, 'test');

    const backupPath = filePath + '.mcode.bak';
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf-8')).toBe('{"original": true}');
  });

  it('does not overwrite existing backup', () => {
    const filePath = join(tempDir, 'config.json');
    const backupPath = filePath + '.mcode.bak';
    writeFileSync(filePath, '{"updated": true}');
    writeFileSync(backupPath, '{"first-backup": true}');

    backupJsonConfig(filePath, 'test');

    expect(readFileSync(backupPath, 'utf-8')).toBe('{"first-backup": true}');
  });

  it('does nothing when source file does not exist', () => {
    const filePath = join(tempDir, 'missing.json');
    backupJsonConfig(filePath, 'test');
    expect(existsSync(filePath + '.mcode.bak')).toBe(false);
  });
});

describe('writeJsonConfig', () => {
  it('writes formatted JSON with trailing newline', () => {
    const filePath = join(tempDir, 'output.json');
    writeJsonConfig(filePath, { key: 'value' });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{\n  "key": "value"\n}\n');
  });

  it('creates parent directories as needed', () => {
    const filePath = join(tempDir, 'nested', 'deep', 'output.json');
    writeJsonConfig(filePath, { nested: true });
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('cleanupJsonConfig', () => {
  it('transforms and writes the config', () => {
    const filePath = join(tempDir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ hooks: { a: 1 }, other: 'keep' }));

    cleanupJsonConfig<{ hooks?: unknown; other?: string }>(
      filePath,
      'test',
      (config) => ({ ...config, hooks: undefined }),
    );

    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(result.other).toBe('keep');
    expect(result.hooks).toBeUndefined();
  });

  it('does nothing when file does not exist', () => {
    const filePath = join(tempDir, 'missing.json');
    cleanupJsonConfig(filePath, 'test', (c) => c);
    expect(existsSync(filePath)).toBe(false);
  });

  it('logs warning and does not throw on invalid JSON', () => {
    const filePath = join(tempDir, 'bad.json');
    writeFileSync(filePath, 'not json');

    // Should not throw
    expect(() => {
      cleanupJsonConfig(filePath, 'test', (c) => c);
    }).not.toThrow();
  });
});
