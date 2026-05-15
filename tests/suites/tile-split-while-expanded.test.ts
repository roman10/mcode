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

// Regression guard for "start a new session while a tile is expanded".
//
// Before the maximizedTree change, maximize was a single-tile overlay portal:
// adding a session while expanded buried it in the hidden background mosaic
// (invisible until restore). The fix makes the overlay a real mini-mosaic
// driven by maximizedTree, so creating a session / opening a file while
// expanded SPLITS the expanded surface — while every tile stays mounted once
// (xterm Terminal / WebGL / broker preserved, asserted via instance token).
describe('split-while-expanded', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baselineTileCount: number;
  let s1Id: string;
  let s3Id: string;

  // Reads the maximize overlay's computed display + the number of mosaic
  // windows it currently hosts (0 when restored / unmounted, 1 when a single
  // tile is expanded, ≥2 once the expanded surface is split).
  async function overlayState(): Promise<{ display: string; windows: number }> {
    return client.callToolJson<{ display: string; windows: number }>(
      'window_execute_js',
      {
        code: `(() => {
          const o = document.querySelector('[data-testid="maximize-overlay"]');
          if (!o) return { display: 'none', windows: 0 };
          return {
            display: getComputedStyle(o).display,
            windows: o.querySelectorAll('.mosaic-window').length,
          };
        })()`,
      },
    );
  }

  const dims = (sessionId: string) =>
    client.callToolJson<{ cols: number; rows: number }>('terminal_get_dimensions', {
      sessionId,
    });
  const token = (sessionId: string) =>
    client.callToolJson<{ token: string }>('terminal_get_instance_token', {
      sessionId,
    });

  beforeAll(async () => {
    await client.connect();

    // Reload so the freshly-built renderer modules mount new sessions.
    try {
      await client.callToolJson<null>('window_execute_js', {
        code: 'location.reload(); null',
      });
    } catch {
      // Expected: the reload tears down the executeJavaScript response.
    }
    await sleep(3000);

    await resetTestState(client);
    baselineTileCount = await getTileCount(client);

    const [s1, s2] = await Promise.all([
      createLiveClaudeTestSession(client),
      createLiveClaudeTestSession(client),
    ]);
    s1Id = s1.sessionId;
    sessionIds.push(s1.sessionId, s2.sessionId);
    await Promise.all([
      waitForActive(client, s1.sessionId),
      waitForActive(client, s2.sessionId),
    ]);
    await waitForTileCount(client, baselineTileCount + 2);
    await sleep(500); // let the split settle and fit() run on each tile
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('creating a session while expanded splits the overlay (both tiles visible)', async () => {
    const beforeMax = await dims(s1Id);
    expect(beforeMax.cols).toBeGreaterThan(0);

    await client.callTool('layout_maximize', { sessionId: s1Id });
    await sleep(600);

    const s1TokenMax = await token(s1Id);
    expect(s1TokenMax.token).toBeTruthy();

    const whileMax = await dims(s1Id);
    expect(whileMax.cols).toBeGreaterThan(beforeMax.cols); // full overlay width

    const single = await overlayState();
    expect(single.display).not.toBe('none');
    expect(single.windows).toBe(1); // only s1 in the overlay

    // Create a new session WHILE expanded — onCreated → addTile splices it
    // into maximizedTree, so the overlay must split into two.
    const s3 = await createLiveClaudeTestSession(client);
    s3Id = s3.sessionId;
    sessionIds.push(s3.sessionId);
    await waitForActive(client, s3.sessionId);
    await waitForTileCount(client, baselineTileCount + 3);
    await sleep(700);

    const split = await overlayState();
    expect(split.display).not.toBe('none');
    expect(split.windows).toBe(2); // overlay split into s1 + s3

    // s1 shrank (it now shares the overlay) and s3 is visibly sized — proving
    // s3 lives in the overlay, not buried in the hidden background mosaic.
    const s1Split = await dims(s1Id);
    expect(s1Split.cols).toBeGreaterThan(0);
    expect(s1Split.cols).toBeLessThan(whileMax.cols);
    const s3Split = await dims(s3Id);
    expect(s3Split.cols).toBeGreaterThan(0);

    // Splitting must not remount s1's xterm Terminal.
    const s1TokenSplit = await token(s1Id);
    expect(s1TokenSplit.token).toBe(s1TokenMax.token);
  });

  it('restoring brings back the full mosaic with the new tile, no remount', async () => {
    const s1Before = await token(s1Id);
    const s3Before = await token(s3Id);

    await client.callTool('layout_restore_from_maximize');
    await sleep(700);

    const restored = await overlayState();
    expect(restored.display).toBe('none'); // overlay lifted
    expect(restored.windows).toBe(0); // inner overlay Mosaic unmounted

    // All three sessions are now tiles in the background mosaic.
    expect(await getTileCount(client)).toBe(baselineTileCount + 3);

    // No remount across the whole maximize → split → restore cycle.
    expect((await token(s1Id)).token).toBe(s1Before.token);
    expect((await token(s3Id)).token).toBe(s3Before.token);
  });
});
