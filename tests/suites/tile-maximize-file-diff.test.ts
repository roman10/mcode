import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
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

// Verifies the maximize TRIGGER path for non-session tiles (file / diff /
// commit-diff). The overlay/portal infrastructure is shared with terminal
// tiles via ClosableTileWrapper; what's exercised here is the generic
// layout_maximize_tile entry point + layout_get_maximized, which let a
// file/diff tile be expanded by leaf id (no sessionId), then restored.
describe('maximize file/diff tile by tile id', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baselineTileCount: number;
  const filePath = join(process.cwd(), 'package.json');
  const fileTileId = `file:${filePath}`;

  async function overlayDisplay(): Promise<string> {
    return client.callToolJson<string>('window_execute_js', {
      code: `(() => {
        const o = document.querySelector('[data-testid="maximize-overlay"]');
        return o ? getComputedStyle(o).display : 'none';
      })()`,
    });
  }

  beforeAll(async () => {
    await client.connect();

    // Reload so the freshly-built renderer modules mount.
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

    // A session tile so there's something to stay in the background mosaic.
    const s1 = await createLiveClaudeTestSession(client);
    sessionIds.push(s1.sessionId);
    await waitForActive(client, s1.sessionId);
    await waitForTileCount(client, baselineTileCount + 1);

    // Open a file viewer tile.
    await client.callTool('file_open_viewer', { absolutePath: filePath });
    await waitForTileCount(client, baselineTileCount + 2);
    await sleep(400);
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('layout_maximize_tile expands the file tile into the overlay', async () => {
    expect(await overlayDisplay()).toBe('none');
    expect(await client.callToolJson<string[]>('layout_get_maximized', {})).toEqual([]);

    await client.callTool('layout_maximize_tile', { tileId: fileTileId });
    await sleep(500);

    expect(await client.callToolJson<string[]>('layout_get_maximized', {})).toContain(
      fileTileId,
    );
    expect(await overlayDisplay()).not.toBe('none');
  });

  it('layout_restore_from_maximize lifts the overlay, tiles preserved', async () => {
    await client.callTool('layout_restore_from_maximize');
    await sleep(500);

    expect(await client.callToolJson<string[]>('layout_get_maximized', {})).toEqual([]);
    expect(await overlayDisplay()).toBe('none');
    // Background mosaic still has the session + file tiles.
    expect(await getTileCount(client)).toBe(baselineTileCount + 2);
  });

  it('closing the maximized file tile clears the overlay (no stale leaf)', async () => {
    await client.callTool('layout_maximize_tile', { tileId: fileTileId });
    await sleep(400);
    expect(await client.callToolJson<string[]>('layout_get_maximized', {})).toContain(
      fileTileId,
    );

    await client.callTool('layout_remove_any_tile', { tileId: fileTileId });
    await sleep(500);

    expect(await client.callToolJson<string[]>('layout_get_maximized', {})).toEqual([]);
    expect(await overlayDisplay()).toBe('none');
  });
});
