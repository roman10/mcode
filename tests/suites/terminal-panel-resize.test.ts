import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

describe('terminal panel resize', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let sessionId: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    const session = await createTestSession(client);
    sessionId = session.sessionId;
    sessionIds.push(sessionId);
    await waitForActive(client, sessionId);
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('xterm container resizes when panel height changes', async () => {
    // Set panel to a small height and wait for layout + fit
    await client.callTool('terminal_panel_set_height', { height: 200 });
    await sleep(500);

    const dim1 = await client.callToolJson<{
      panelHeight: number;
      panelClientHeight: number;
      xtermHeight: number;
    }>('terminal_panel_get_dimensions', {});

    expect(dim1.panelClientHeight).toBeGreaterThan(0);
    expect(dim1.xtermHeight).toBeGreaterThan(0);

    // Set panel to a larger height
    await client.callTool('terminal_panel_set_height', { height: 400 });
    await sleep(500);

    const dim2 = await client.callToolJson<{
      panelHeight: number;
      panelClientHeight: number;
      xtermHeight: number;
    }>('terminal_panel_get_dimensions', {});

    // xterm must grow when panel grows
    expect(dim2.xtermHeight).toBeGreaterThan(dim1.xtermHeight);

    // Growth should roughly match panel growth (±20px tolerance for row rounding)
    const panelGrowth = dim2.panelClientHeight - dim1.panelClientHeight;
    const xtermGrowth = dim2.xtermHeight - dim1.xtermHeight;
    expect(Math.abs(panelGrowth - xtermGrowth)).toBeLessThan(20);
  });
});
