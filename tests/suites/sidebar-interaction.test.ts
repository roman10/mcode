import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
} from '../helpers';

describe('sidebar interaction', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
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
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    await client.callTool('sidebar_select_session', {
      sessionId: session.sessionId,
    });

    const selected = await client.callToolJson<{
      selectedSessionId: string | null;
    }>('sidebar_get_selected');

    expect(selected.selectedSessionId).toBe(session.sessionId);
  });

  it('deselects with null', async () => {
    await client.callTool('sidebar_select_session', { sessionId: null });

    const selected = await client.callToolJson<{
      selectedSessionId: string | null;
    }>('sidebar_get_selected');

    expect(selected.selectedSessionId).toBeNull();
  });

  it('switches selection between sessions', async () => {
    const session2 = await createTestSession(client);
    sessionIds.push(session2.sessionId);
    await waitForActive(client, session2.sessionId);

    // Select first
    await client.callTool('sidebar_select_session', {
      sessionId: sessionIds[0],
    });
    let selected = await client.callToolJson<{
      selectedSessionId: string | null;
    }>('sidebar_get_selected');
    expect(selected.selectedSessionId).toBe(sessionIds[0]);

    // Switch to second
    await client.callTool('sidebar_select_session', {
      sessionId: sessionIds[1],
    });
    selected = await client.callToolJson<{
      selectedSessionId: string | null;
    }>('sidebar_get_selected');
    expect(selected.selectedSessionId).toBe(sessionIds[1]);
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
    await new Promise((r) => setTimeout(r, 300));

    const updated = parseInt(
      await client.callToolText('layout_get_sidebar_width'),
      10,
    );
    expect(updated).toBe(target);

    // Restore original
    await client.callTool('layout_set_sidebar_width', { width: original });
  });
});
