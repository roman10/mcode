import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  getSidebarSelected,
  sleep,
} from '../helpers';

describe('sidebar interaction', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  // session1Id is created in beforeAll so tests that use it don't depend on
  // the first 'it' block having run.
  let session1Id: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    const s = await createTestSession(client);
    await waitForActive(client, s.sessionId);
    session1Id = s.sessionId;
    sessionIds.push(session1Id);
  });

  afterAll(async () => {
    // Deselect before cleanup
    try {
      await client.callTool('sidebar_select_session', { sessionId: null });
    } catch { /* best-effort */ }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('selects a session', async () => {
    await client.callTool('sidebar_select_session', {
      sessionId: session1Id,
    });

    const selected = await getSidebarSelected(client);

    expect(selected.selectedSessionId).toBe(session1Id);
  });

  it('deselects with null', async () => {
    await client.callTool('sidebar_select_session', { sessionId: null });

    const selected = await getSidebarSelected(client);

    expect(selected.selectedSessionId).toBeNull();
  });

  it('switches selection between sessions', async () => {
    const session2 = await createTestSession(client);
    sessionIds.push(session2.sessionId);
    await waitForActive(client, session2.sessionId);

    // Select first
    await client.callTool('sidebar_select_session', {
      sessionId: session1Id,
    });
    let selected = await getSidebarSelected(client);
    expect(selected.selectedSessionId).toBe(session1Id);

    // Switch to second
    await client.callTool('sidebar_select_session', {
      sessionId: session2.sessionId,
    });
    selected = await getSidebarSelected(client);
    expect(selected.selectedSessionId).toBe(session2.sessionId);
  });

  it('gets sidebar width', async () => {
    const widthStr = await client.callToolText('layout_get_sidebar_width');
    const width = parseInt(widthStr, 10);

    expect(width).toBeGreaterThanOrEqual(200);
    expect(width).toBeLessThanOrEqual(500);
  });

  it('sets sidebar width and reads it back', async () => {
    const original = parseInt(
      await client.callToolText('layout_get_sidebar_width'),
      10,
    );

    const target = 350;
    await client.callTool('layout_set_sidebar_width', { width: target });

    // Give persist debounce time to settle
    await sleep(300);

    const updated = parseInt(
      await client.callToolText('layout_get_sidebar_width'),
      10,
    );
    expect(updated).toBe(target);

    // Restore original
    await client.callTool('layout_set_sidebar_width', { width: original });
  });
});
