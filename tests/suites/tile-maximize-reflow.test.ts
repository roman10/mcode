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

// Verifies that maximizing a coding-session tile in the mosaic reflows the
// terminal: fitAddon must run, xterm.resize must change cols, and pty.resize
// must propagate. ResizeObserver normally fires on the resulting DOM reflow,
// but TerminalInstance also subscribes to layout-store mosaicTree/maximizedTree
// transitions as a backstop for when Electron's render loop is paused.
// The maximized tile is portaled into MosaicLayout's overlay layer rather than
// replacing the mosaic tree, so every TerminalInstance stays mounted across the
// cycle — but the maximized tile's container still resizes (mosaic pane bounds
// → overlay layer bounds and back), which is what this test exercises.
describe('tile maximize reflows terminal', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baselineTileCount: number;
  let session1Id: string;

  beforeAll(async () => {
    await client.connect();

    // Reload the renderer so the freshly-built TerminalInstance code is the
    // module instance that mounts new sessions.
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
    // Tiles are auto-added on session creation; wait for both leaves
    await waitForTileCount(client, baselineTileCount + 2);
    await sleep(500); // let the split layout settle and fit() run on each tile
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('maximize then restore changes terminal cols on the affected tile', async () => {
    const beforeMax = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    expect(beforeMax.cols).toBeGreaterThan(0);

    await client.callTool('layout_maximize', { sessionId: session1Id });
    // ResizeObserver tick + setTimeout(0) fit + onResize → IPC + atlas clear.
    await sleep(600);

    const whileMax = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    expect(whileMax.cols).toBeGreaterThan(beforeMax.cols);

    // Restore back to the split layout — the maximized tile must shrink again,
    // proving the layout-store backstop also fires on maximizedTree → null.
    await client.callTool('layout_restore_from_maximize');
    await sleep(600);

    const afterRestore = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId: session1Id },
    );
    expect(afterRestore.cols).toBeLessThan(whileMax.cols);
  });

  // The dimension-only check above passes whether the xterm Terminal is
  // preserved or rebuilt at the same size, because fit() reproduces the
  // dimensions either way. The instance token distinguishes the two: same
  // token across the cycle means the same Terminal object — and with it the
  // FitAddon, WebGL atlas, scrollback, and broker offset — survived.
  it('preserves the same xterm Terminal across maximize and restore', async () => {
    const before = await client.callToolJson<{ token: string }>(
      'terminal_get_instance_token',
      { sessionId: session1Id },
    );
    expect(before.token).toBeTruthy();

    await client.callTool('layout_maximize', { sessionId: session1Id });
    await sleep(600);

    const whileMax = await client.callToolJson<{ token: string }>(
      'terminal_get_instance_token',
      { sessionId: session1Id },
    );
    expect(whileMax.token).toBe(before.token);

    await client.callTool('layout_restore_from_maximize');
    await sleep(600);

    const afterRestore = await client.callToolJson<{ token: string }>(
      'terminal_get_instance_token',
      { sessionId: session1Id },
    );
    expect(afterRestore.token).toBe(before.token);
  });
});
