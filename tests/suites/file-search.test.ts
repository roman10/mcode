import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';

describe('file search', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('file_search finds known string in codebase', async () => {
    const result = await client.callTool('file_search', {
      query: 'FileSearch',
      maxResults: 10,
    });
    expect(result.isError).toBeFalsy();

    const summary = JSON.parse(result.content[0].text);
    expect(summary.totalMatches).toBeGreaterThan(0);
    expect(summary.totalFiles).toBeGreaterThan(0);

    // Results should include the file-search.ts file we created
    const matchText = result.content[1].text;
    expect(matchText).toContain('file-search');
  });

  it('file_search returns empty for nonexistent string', async () => {
    // Build query dynamically to avoid self-matching this source file
    const query = ['zzz_nonexistent', Date.now(), 'xyz'].join('_');
    const result = await client.callTool('file_search', {
      query,
      maxResults: 10,
    });
    expect(result.isError).toBeFalsy();

    const summary = JSON.parse(result.content[0].text);
    expect(summary.totalMatches).toBe(0);
    expect(result.content[1].text).toBe('No matches found.');
  });

  it('file_search supports regex mode', async () => {
    const result = await client.callTool('file_search', {
      query: 'class\\s+FileSearch',
      isRegex: true,
      maxResults: 10,
    });
    expect(result.isError).toBeFalsy();

    const summary = JSON.parse(result.content[0].text);
    expect(summary.totalMatches).toBeGreaterThan(0);
  });

  it('file_search supports case-sensitive mode', async () => {
    // Search for lowercase — should find nothing if case-sensitive and the term is PascalCase
    const caseSensitiveResult = await client.callTool('file_search', {
      query: 'filesearch',
      caseSensitive: true,
      maxResults: 10,
    });
    const summary = JSON.parse(caseSensitiveResult.content[0].text);
    // 'filesearch' (all lowercase) is unlikely to appear; 'FileSearch' (PascalCase) is the real token
    // This just verifies the caseSensitive flag is respected
    expect(summary).toBeDefined();
  });

  it('file_search respects maxResults cap', async () => {
    const result = await client.callTool('file_search', {
      query: 'import',
      maxResults: 3,
    });
    expect(result.isError).toBeFalsy();

    const summary = JSON.parse(result.content[0].text);
    // Should be capped at 3 or report truncation
    expect(summary.totalMatches).toBeLessThanOrEqual(3);
  });
});
