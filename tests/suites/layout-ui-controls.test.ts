import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  getTileCount,
  type SessionInfo,
} from '../helpers';

describe('layout UI controls', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let originalCollapsed: boolean;

  beforeAll(async () => {
    await client.connect();

    // Create 2 sessions with tiles
    const [s1, s2] = await Promise.all([
      createTestSession(client),
      createTestSession(client),
    ]);
    sessionIds.push(s1.sessionId, s2.sessionId);
    await Promise.all([
      waitForActive(client, s1.sessionId),
      waitForActive(client, s2.sessionId),
    ]);
    // Auto-tile should have added tiles; wait briefly for IPC
    await new Promise((r) => setTimeout(r, 500));

    // Save original sidebar collapsed state
    const state = await client.callToolJson<{ collapsed: boolean }>(
      'layout_get_sidebar_collapsed',
    );
    originalCollapsed = state.collapsed;
  });

  afterAll(async () => {
    // Restore sidebar collapsed state
    await client.callTool('layout_set_sidebar_collapsed', {
      collapsed: originalCollapsed,
    });
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('remove_all_tiles empties the layout', async () => {
    await client.callTool('layout_remove_all_tiles');
    const count = await getTileCount(client);
    expect(count).toBe(0);
  });

  it('sessions survive remove_all_tiles', async () => {
    // Both sessions should still be active after tiles were removed
    for (const id of sessionIds) {
      const session = await client.callToolJson<SessionInfo>(
        'session_get_status',
        { sessionId: id },
      );
      expect(session.status).toBe('active');
    }
  });

  it('can re-add tiles after remove_all', async () => {
    await client.callTool('layout_add_tile', { sessionId: sessionIds[0] });
    const count = await getTileCount(client);
    expect(count).toBe(1);

    // Add second tile back
    await client.callTool('layout_add_tile', { sessionId: sessionIds[1] });
    const count2 = await getTileCount(client);
    expect(count2).toBe(2);
  });

  it('get/set sidebar collapsed round-trips', async () => {
    // Set collapsed to true
    await client.callTool('layout_set_sidebar_collapsed', { collapsed: true });
    const state1 = await client.callToolJson<{ collapsed: boolean }>(
      'layout_get_sidebar_collapsed',
    );
    expect(state1.collapsed).toBe(true);

    // Set collapsed to false
    await client.callTool('layout_set_sidebar_collapsed', {
      collapsed: false,
    });
    const state2 = await client.callToolJson<{ collapsed: boolean }>(
      'layout_get_sidebar_collapsed',
    );
    expect(state2.collapsed).toBe(false);
  });

  it('toggle_keyboard_shortcuts toggles state', async () => {
    // First toggle
    const text1 = await client.callToolText('layout_toggle_keyboard_shortcuts');
    const shown = text1.includes('shown');

    // Second toggle — should return the opposite
    const text2 = await client.callToolText('layout_toggle_keyboard_shortcuts');
    const shownAgain = text2.includes('shown');

    expect(shownAgain).toBe(!shown);
  });

  it('toggle_dashboard toggles and affects tile count', async () => {
    const before = await getTileCount(client);

    // First toggle
    const text1 = await client.callToolText('layout_toggle_dashboard');
    const added = text1.includes('added');
    const after1 = await getTileCount(client);

    if (added) {
      expect(after1).toBe(before + 1);
    } else {
      expect(after1).toBe(before - 1);
    }

    // Second toggle — restore
    await client.callTool('layout_toggle_dashboard');
    const after2 = await getTileCount(client);
    expect(after2).toBe(before);
  });

  it('remove_all_tiles is idempotent', async () => {
    await client.callTool('layout_remove_all_tiles');
    const result = await client.callTool('layout_remove_all_tiles');
    expect(result.isError).toBeFalsy();
    const count = await getTileCount(client);
    expect(count).toBe(0);
  });
});
