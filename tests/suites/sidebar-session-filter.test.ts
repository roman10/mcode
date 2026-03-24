import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  setSessionFilter,
  getSessionFilter,
  resetTestState,
} from '../helpers';

describe('sidebar session filter', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await setSessionFilter(client, '');
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('set and get filter query', async () => {
    await setSessionFilter(client, 'my-query');
    const query = await getSessionFilter(client);
    expect(query).toBe('my-query');
  });

  it('clear filter with empty string', async () => {
    await setSessionFilter(client, 'something');
    await setSessionFilter(client, '');
    const query = await getSessionFilter(client);
    expect(query).toBe('');
  });

  it('filter does not affect sidebar_get_sessions (UI-only)', async () => {
    // Create sessions with distinct labels
    const s1 = await createTestSession(client, {
      sessionType: 'terminal',
      label: `filter-alpha-${Date.now()}`,
    });
    sessionIds.push(s1.sessionId);
    await waitForActive(client, s1.sessionId);

    const s2 = await createTestSession(client, {
      sessionType: 'terminal',
      label: `filter-beta-${Date.now()}`,
    });
    sessionIds.push(s2.sessionId);
    await waitForActive(client, s2.sessionId);

    // Set a filter that matches only one
    await setSessionFilter(client, 'alpha');

    // sidebar_get_sessions returns from DB/store, not affected by UI filter
    const sessions = await client.callToolJson<{ sessionId: string }[]>(
      'sidebar_get_sessions',
    );
    const foundAlpha = sessions.find((s) => s.sessionId === s1.sessionId);
    const foundBeta = sessions.find((s) => s.sessionId === s2.sessionId);
    expect(foundAlpha).toBeDefined();
    expect(foundBeta).toBeDefined();

    // But the filter is set
    const query = await getSessionFilter(client);
    expect(query).toBe('alpha');

    // Clean up filter
    await setSessionFilter(client, '');
  });
});
