import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

describe('file tools', () => {
  const client = new McpTestClient();
  const cwd = process.cwd();
  const tmpFiles: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    // Best-effort cleanup of temp files
    for (const f of tmpFiles) {
      try {
        await unlink(f);
      } catch { /* best-effort */ }
    }
    await client.disconnect();
  });

  it('file_list returns files for git repo', async () => {
    const result = await client.callToolJson<{
      isGitRepo: boolean;
      count: number;
      files: string[];
      dirs: string[];
    }>('file_list', { cwd });

    expect(result.isGitRepo).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files.length).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.dirs)).toBe(true);
    expect(result.dirs.length).toBeGreaterThan(0);
    expect(result.dirs.every((d: string) => d.endsWith('/'))).toBe(true);
  });

  it('file_read returns content and language for known file', async () => {
    const result = await client.callTool('file_read', {
      cwd,
      relativePath: 'package.json',
    });
    expect(result.isError).toBeFalsy();

    // First content item has language metadata
    const meta = JSON.parse(result.content[0].text);
    expect(meta.language).toBe('json');
    expect(meta.lines).toBeGreaterThan(0);

    // Second content item has the actual file content
    expect(result.content[1].text).toContain('"name"');
  });

  it('file_read returns binary message for non-text file', async () => {
    const result = await client.callToolText('file_read', {
      cwd,
      relativePath: 'resources/icon.icns',
    });
    expect(result).toContain('Binary file');
  });

  it('file_write creates file and file_read reads it back', async () => {
    const relPath = `tests/fixtures/tmp-test-${Date.now()}.txt`;
    const content = 'hello from file-tools integration test';
    tmpFiles.push(join(cwd, relPath));

    const writeText = await client.callToolText('file_write', {
      cwd,
      relativePath: relPath,
      content,
    });
    expect(writeText).toContain('Written');

    // Read it back
    const result = await client.callTool('file_read', {
      cwd,
      relativePath: relPath,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[1].text).toBe(content);
  });

  it('file_write returns character count', async () => {
    const relPath = `tests/fixtures/tmp-count-${Date.now()}.txt`;
    const content = 'exactly 28 characters long!!';
    tmpFiles.push(join(cwd, relPath));

    const text = await client.callToolText('file_write', {
      cwd,
      relativePath: relPath,
      content,
    });
    expect(text).toContain('Written');
    expect(text).toContain(String(content.length));
  });

  it('file_open_viewer returns success', async () => {
    const absolutePath = join(cwd, 'package.json');
    const text = await client.callToolText('file_open_viewer', { absolutePath });
    expect(text).toContain('Opened file viewer');
  });

  it('quick_open_toggle returns mode confirmation', async () => {
    const text1 = await client.callToolText('quick_open_toggle', { mode: 'files' });
    expect(text1).toContain('files');

    const text2 = await client.callToolText('quick_open_toggle', { mode: 'commands' });
    expect(text2).toContain('commands');

    // Dismiss the overlay so it doesn't bleed into subsequent tests
    try {
      await client.callToolText('quick_open_toggle', { mode: 'commands' });
    } catch { /* best-effort close */ }
  });
});
