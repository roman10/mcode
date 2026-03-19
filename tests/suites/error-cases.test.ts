import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';

const FAKE_ID = '00000000-0000-0000-0000-000000000000';

describe('error cases', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  // --- Session errors ---

  it('session_get_status returns error for non-existent session', async () => {
    const result = await client.callTool('session_get_status', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('session_kill returns error for non-existent session', async () => {
    const result = await client.callTool('session_kill', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('session_set_label returns error for non-existent session', async () => {
    const result = await client.callTool('session_set_label', {
      sessionId: FAKE_ID,
      label: 'nope',
    });
    expect(result.isError).toBe(true);
  });

  it('session_info returns error for non-existent PTY', async () => {
    const result = await client.callTool('session_info', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('session_wait_for_status returns error for non-existent session', async () => {
    const result = await client.callTool('session_wait_for_status', {
      sessionId: FAKE_ID,
      status: 'active',
      timeout_ms: 500,
    });
    expect(result.isError).toBe(true);
  });

  // --- Terminal errors ---

  it('terminal_read_buffer returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_read_buffer', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('terminal_send_keys returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_send_keys', {
      sessionId: FAKE_ID,
      keys: 'hello',
    });
    expect(result.isError).toBe(true);
  });

  it('terminal_get_dimensions returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_get_dimensions', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('terminal_resize returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_resize', {
      sessionId: FAKE_ID,
      cols: 80,
      rows: 24,
    });
    expect(result.isError).toBe(true);
  });

  it('terminal_wait_for_content returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_wait_for_content', {
      sessionId: FAKE_ID,
      pattern: 'anything',
      timeout_ms: 500,
    });
    expect(result.isError).toBe(true);
  });

  // --- Layout errors ---

  it('layout_add_tile returns error for non-existent session', async () => {
    const result = await client.callTool('layout_add_tile', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  // --- Session delete errors ---

  it('session_delete returns error for non-existent session', async () => {
    const result = await client.callTool('session_delete', {
      sessionId: FAKE_ID,
    });
    expect(result.isError).toBe(true);
  });

  // --- Terminal action errors ---

  it('terminal_execute_action returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_execute_action', {
      sessionId: FAKE_ID,
      action: 'copy',
    });
    expect(result.isError).toBe(true);
  });

  it('terminal_drop_files returns error for non-existent session', async () => {
    const result = await client.callTool('terminal_drop_files', {
      sessionId: FAKE_ID,
      filePaths: ['/tmp/x'],
    });
    expect(result.isError).toBe(true);
  });
});
