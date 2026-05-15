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

// Regression guard for the broader latent bug behind the background-mosaic
// refactor: react-mosaic keys leaves per-parent, so ANY background-tree
// restructure (balanced rebuild on add, removeLeaf collapse, AND user
// drag-rearrange) used to unmount/remount the affected TileFactory — silently
// disposing the xterm Terminal / WebGL atlas / scrollback. After the refactor
// every tile is mounted once in a flat list keyed by tileId and portals into a
// slot, so no restructure remounts it.
//
// Drag-rearrange itself can't be driven from a test (react-dnd HTML5 drag is
// not simulable via MCP, and the renderer's module graph isn't reachable from
// window_execute_js to call setMosaicTree directly). Both cases below exercise
// the SAME react-mosaic per-parent remount mechanism through first-class
// tooling: add-triggered balanced rebuild and remove-triggered collapse.
describe('tile tree stability (no remount on background restructure)', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baseline: number;

  const token = (sessionId: string) =>
    client.callToolJson<{ token: string }>('terminal_get_instance_token', { sessionId });
  const dims = (sessionId: string) =>
    client.callToolJson<{ cols: number; rows: number }>('terminal_get_dimensions', {
      sessionId,
    });

  beforeAll(async () => {
    await client.connect();
    try {
      await client.callToolJson<null>('window_execute_js', {
        code: 'location.reload(); null',
      });
    } catch {
      // Expected: the reload tears down the executeJavaScript response.
    }
    await sleep(3000);
    await resetTestState(client);
    baseline = await getTileCount(client);
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('balanced rebuild on add preserves every existing tile (no remount)', async () => {
    const [s1, s2] = await Promise.all([
      createLiveClaudeTestSession(client),
      createLiveClaudeTestSession(client),
    ]);
    sessionIds.push(s1.sessionId, s2.sessionId);
    await Promise.all([
      waitForActive(client, s1.sessionId),
      waitForActive(client, s2.sessionId),
    ]);
    await waitForTileCount(client, baseline + 2);
    await sleep(500);

    const t1 = await token(s1.sessionId);
    const t2 = await token(s2.sessionId);
    expect(t1.token).toBeTruthy();
    expect(t2.token).toBeTruthy();

    // Creating a 3rd session calls addTile → createBalancedTreeFromLeaves,
    // which rebuilds the whole background tree (changes s1/s2 nesting).
    const s3 = await createLiveClaudeTestSession(client);
    sessionIds.push(s3.sessionId);
    await waitForActive(client, s3.sessionId);
    await waitForTileCount(client, baseline + 3);
    await sleep(700);

    expect((await token(s1.sessionId)).token).toBe(t1.token);
    expect((await token(s2.sessionId)).token).toBe(t2.token);
    expect((await dims(s1.sessionId)).cols).toBeGreaterThan(0);
    expect((await dims(s2.sessionId)).cols).toBeGreaterThan(0);
  });

  it('removeLeaf collapse preserves the surviving tiles (no remount)', async () => {
    const [a, b, c] = sessionIds.slice(-3);
    const ta = await token(a);
    const tb = await token(b);
    expect(ta.token).toBeTruthy();
    expect(tb.token).toBeTruthy();

    // Removing c's tile (session stays alive) collapses the split and
    // restructures a/b's nesting — the same per-parent remount trigger as a
    // drag-rearrange.
    await client.callTool('layout_remove_tile', { sessionId: c });
    await waitForTileCount(client, baseline + 2);
    await sleep(700);

    expect((await token(a)).token).toBe(ta.token);
    expect((await token(b)).token).toBe(tb.token);
    expect((await dims(a)).cols).toBeGreaterThan(0);
    expect((await dims(b)).cols).toBeGreaterThan(0);
  });
});
