import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { getSidebarActiveTab, switchSidebarTab, resetTestState } from '../helpers';

describe('sidebar tabs', () => {
  const client = new McpTestClient();
  let originalTab: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    originalTab = await getSidebarActiveTab(client);
  });

  afterAll(async () => {
    // Restore original tab
    await switchSidebarTab(client, originalTab as 'sessions' | 'commits' | 'tokens' | 'activity');
    await client.disconnect();
  });

  it('get_active_tab returns current tab', async () => {
    const tab = await getSidebarActiveTab(client);
    expect(['sessions', 'commits', 'tokens', 'activity']).toContain(tab);
  });

  it('switch_tab switches to each tab', async () => {
    const tabs = ['tokens', 'commits', 'activity', 'sessions'] as const;
    for (const tab of tabs) {
      await switchSidebarTab(client, tab);
      const active = await getSidebarActiveTab(client);
      expect(active).toBe(tab);
    }
  });

  it('switch_tab returns confirmation text', async () => {
    const text = await switchSidebarTab(client, 'tokens');
    expect(text).toContain('Sidebar switched to');
    expect(text).toContain('tokens');
  });

  it('switch_tab round-trips correctly', async () => {
    await switchSidebarTab(client, 'tokens');
    expect(await getSidebarActiveTab(client)).toBe('tokens');

    await switchSidebarTab(client, 'sessions');
    expect(await getSidebarActiveTab(client)).toBe('sessions');
  });
});
