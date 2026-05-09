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

// Verifies that maximizing one tile does not shrink the other (now-hidden) tile.
//
// Bug: when a tile is maximized, the non-maximized tiles' wrappers go
// display:none. The layout-store subscription in TerminalInstance still
// scheduled a rAF + 100ms `verifyAndCorrectFit` pass on every TerminalInstance,
// including the hidden ones. FitAddon.proposeDimensions reads
// `getComputedStyle(parent).width`, which returns the *specified* value
// ("100%") under display:none ancestors instead of a resolved pixel value;
// parseInt("100%") = 100 → ~10 cols → fit() shrunk the hidden terminal to a
// narrow grid that survived until the next visible refit.
//
// Fix: skip verifyAndCorrectFit when the parent's clientWidth/clientHeight is
// zero, mirroring the gate `safeFit` already enforces. Hidden tiles re-fit
// naturally on reveal via ResizeObserver.
describe('tile maximize does not shrink hidden tiles', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baselineTileCount: number;
  let session1Id: string;
  let session2Id: string;

  beforeAll(async () => {
    await client.connect();

    // Reload so the freshly-built terminal-registry code is the module instance
    // serving the renderer.
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
    session2Id = s2.sessionId;
    sessionIds.push(s1.sessionId, s2.sessionId);
    await Promise.all([
      waitForActive(client, s1.sessionId),
      waitForActive(client, s2.sessionId),
    ]);
    await waitForTileCount(client, baselineTileCount + 2);
    // Let split fit() settle on both tiles before we sample baseline cols.
    await sleep(500);
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('hidden tile keeps its cols when another tile is maximized', async () => {
    const before = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session2Id },
    );
    expect(before.cols).toBeGreaterThan(20);

    await client.callTool('layout_maximize', { sessionId: session1Id });
    // Cover both rAF and the 100ms verifyAndCorrectFit pass on the hidden tile.
    await sleep(300);

    const whileMax = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session2Id },
    );
    // Pre-fix: whileMax.cols collapses to ~10 because verifyAndCorrectFit ran
    // on the display:none wrapper and FitAddon read getComputedStyle.width as
    // the literal "100%". Post-fix: cols are unchanged.
    expect(whileMax.cols).toBe(before.cols);
    expect(whileMax.rows).toBe(before.rows);

    await client.callTool('layout_restore_from_maximize');
    await sleep(600);

    const afterRestore = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session2Id },
    );
    expect(afterRestore.cols).toBe(before.cols);
    expect(afterRestore.rows).toBe(before.rows);
  });
});
