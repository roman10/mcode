import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

describe('git tools', () => {
  const client = new McpTestClient();
  const cwd = process.cwd();

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('git_get_status returns valid shape for repo cwd', async () => {
    const result = await client.callTool('git_get_status', { cwd });
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed).toHaveProperty('repoRoot');
    expect(Array.isArray(parsed.staged)).toBe(true);
    expect(Array.isArray(parsed.unstaged)).toBe(true);
    for (const entry of [...parsed.staged, ...parsed.unstaged]) {
      expect(entry).toHaveProperty('path');
      expect(entry).toHaveProperty('status');
    }
  });

  it('git_get_status returns empty arrays for non-git path', async () => {
    const result = await client.callTool('git_get_status', { cwd: '/tmp' });
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.staged).toEqual([]);
    expect(parsed.unstaged).toEqual([]);
  });

  it('git_get_all_statuses returns array', async () => {
    const result = await client.callTool('git_get_all_statuses', {});
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(result.content[0].text!);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('git_get_diff_content returns diff shape for known file', async () => {
    const result = await client.callTool('git_get_diff_content', {
      cwd,
      filePath: join(cwd, 'package.json'),
    });
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text!;
    // Either a JSON diff object or "Binary file" message
    if (!text.includes('Binary file')) {
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('originalContent');
      expect(parsed).toHaveProperty('modifiedContent');
      expect(parsed).toHaveProperty('language');
    }
  });

  it('git_get_diff_content returns empty content for non-existent file', async () => {
    const result = await client.callTool('git_get_diff_content', {
      cwd,
      filePath: join(cwd, 'nonexistent-file-mcode-test.xyz'),
    });
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.binary).toBe(false);
    expect(parsed.originalContent).toBe('');
    expect(parsed.modifiedContent).toBe('');
  });

  it('git_open_diff_viewer returns success', async () => {
    const absolutePath = join(cwd, 'package.json');
    const text = await client.callToolText('git_open_diff_viewer', { absolutePath });
    expect(text).toContain('Opened diff viewer');
  });
});
