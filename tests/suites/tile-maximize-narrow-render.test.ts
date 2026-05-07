import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  waitForTileCount,
  getTileCount,
  sleep,
} from '../helpers';

// Verifies the post-maximize narrow-render fix.
//
// Bug: when a tile is maximized, the layout-store subscription scheduled a
// `setTimeout(0)` fit, which could fire before the browser's layout pass had
// settled the newly-visible overlay's size. fit() then read a transient narrow
// `clientWidth`, computed narrow cols, and locked the terminal there with no
// corrective second pass.
//
// Fix: the same subscription now also schedules a rAF + 100ms verifyAndCorrectFit
// pass. Each pass calls `fitAddon.proposeDimensions()` and re-fits only when
// it disagrees with the live cols/rows by more than 1. This test exercises the
// stability of the post-maximize state — if the late corrective resize were
// still pending, two cols reads 250ms apart would differ.
describe('tile maximize narrow-render fix', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baselineTileCount: number;
  let session1Id: string;

  beforeAll(async () => {
    await client.connect();

    // Reload so the freshly-built TerminalInstance code mounts new sessions.
    try {
      await client.callToolJson<null>('window_execute_js', {
        code: 'location.reload(); null',
      });
    } catch {
      // Expected: renderer reloads, breaking the executeJavaScript response
    }
    await sleep(3000);

    await resetTestState(client);
    baselineTileCount = await getTileCount(client);

    const [s1, s2] = await Promise.all([
      createLiveClaudeTestSession(client),
      createLiveClaudeTestSession(client),
    ]);
    session1Id = s1.sessionId;
    sessionIds.push(s1.sessionId, s2.sessionId);
    await Promise.all([
      waitForActive(client, s1.sessionId),
      waitForActive(client, s2.sessionId),
    ]);
    await waitForTileCount(client, baselineTileCount + 2);
    await sleep(500);
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('cols remain stable after maximize (auto-fix verification passes have settled)', async () => {
    const before = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );

    await client.callTool('layout_maximize', { sessionId: session1Id });
    // setTimeout(0) fit + rAF verify + 100ms verify + slack.
    await sleep(800);

    const first = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    expect(first.cols).toBeGreaterThan(before.cols);

    await sleep(250);

    const second = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    // No late corrective resize should still be pending — the two reads must agree.
    expect(second.cols).toBe(first.cols);
    expect(second.rows).toBe(first.rows);

    await client.callTool('layout_restore_from_maximize');
    await sleep(800);

    const afterRestore = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    expect(afterRestore.cols).toBeLessThan(first.cols);
  });

  it('terminal_execute_action refit succeeds and is idempotent on a healthy terminal', async () => {
    // Refit while the tile is in its normal split state — no narrow lock,
    // so verifyAndCorrectFit's mismatch check would see nothing to fix.
    // We're verifying the MCP action wires through correctly and doesn't disturb
    // a terminal that's already at the right size.
    const before = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );

    const result = await client.callToolText('terminal_execute_action', {
      sessionId: session1Id,
      action: 'refit',
    });
    expect(result).toContain("'refit' executed successfully");

    await sleep(150);

    const after = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    // Refit should not change the dimensions when the terminal is already correctly sized.
    expect(after.cols).toBe(before.cols);
    expect(after.rows).toBe(before.rows);
  });

  it('refit also works while the tile is maximized', async () => {
    await client.callTool('layout_maximize', { sessionId: session1Id });
    await sleep(800);

    const beforeRefit = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );

    const result = await client.callToolText('terminal_execute_action', {
      sessionId: session1Id,
      action: 'refit',
    });
    expect(result).toContain("'refit' executed successfully");

    await sleep(150);

    const afterRefit = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    expect(afterRefit.cols).toBe(beforeRefit.cols);
    expect(afterRefit.rows).toBe(beforeRefit.rows);

    await client.callTool('layout_restore_from_maximize');
    await sleep(600);
  });
});
