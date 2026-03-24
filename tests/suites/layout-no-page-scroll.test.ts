import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';

describe('page should not be scrollable', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('document scrollHeight does not exceed clientHeight', async () => {
    const result = await client.callToolJson<{
      scrollHeight: number;
      clientHeight: number;
    }>(
      'window_execute_js',
      {
        code: '({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight })',
      },
    );
    expect(result.scrollHeight).toBeLessThanOrEqual(result.clientHeight);
  });
});
