import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

/**
 * Drives the "Preserve scrollback during TUI redraws" Setting end-to-end:
 *   1. default OFF → \x1b[3J wipes scrollback
 *   2. opt in     → \x1b[3J is suppressed, scrollback retained
 *   3. opt out    → live-toggle takes effect on the same session, scrollback wiped again
 *
 * Uses `printf '\\033[3J'` rather than passing the ESC sequence as keys
 * directly, because terminal_send_keys writes to the PTY (which is parsed
 * by bash); we need the shell to *output* the sequence so xterm.js sees it.
 */
describe('terminal preserve-scrollback setting', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let sessionId: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    // Make sure we start from the documented default.
    await client.callTool('terminal_set_preserve_scrollback', { enabled: false });

    const session = await createTestSession(client);
    sessionId = session.sessionId;
    sessionIds.push(sessionId);
    await waitForActive(client, sessionId);
  });

  afterAll(async () => {
    await client.callTool('terminal_set_preserve_scrollback', { enabled: false });
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  async function fillScrollbackWithMarker(marker: string): Promise<void> {
    // Print the marker, push it well off-screen with a long seq so it lives
    // in scrollback (not viewport) regardless of terminal height, then echo
    // a unique end-token we can wait on without racing the command echo.
    const endToken = `END-${marker}`;
    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: `echo ${marker}; seq 300; echo ${endToken}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: endToken,
      timeout_ms: 10000,
    });
  }

  async function emitEraseScrollback(): Promise<void> {
    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: `printf '\\033[3J'\\r`,
    });
    await sleep(250);
  }

  async function readWithScrollback(): Promise<string> {
    return client.callToolText('terminal_read_buffer', {
      sessionId,
      lines: 500,
    });
  }

  it('reports the default (false) and reflects the toggle', async () => {
    const initial = await client.callToolJson<{ enabled: boolean }>(
      'terminal_get_preserve_scrollback',
    );
    expect(initial.enabled).toBe(false);

    await client.callTool('terminal_set_preserve_scrollback', { enabled: true });
    const enabled = await client.callToolJson<{ enabled: boolean }>(
      'terminal_get_preserve_scrollback',
    );
    expect(enabled.enabled).toBe(true);

    await client.callTool('terminal_set_preserve_scrollback', { enabled: false });
    const disabled = await client.callToolJson<{ enabled: boolean }>(
      'terminal_get_preserve_scrollback',
    );
    expect(disabled.enabled).toBe(false);
  });

  it('default OFF: \\x1b[3J wipes scrollback', async () => {
    await client.callTool('terminal_set_preserve_scrollback', { enabled: false });
    const marker = `wipe-${Date.now()}`;

    await fillScrollbackWithMarker(marker);
    expect(await readWithScrollback()).toContain(marker);

    await emitEraseScrollback();
    expect(await readWithScrollback()).not.toContain(marker);
  });

  it('opt-in: \\x1b[3J is suppressed and scrollback is preserved', async () => {
    await client.callTool('terminal_set_preserve_scrollback', { enabled: true });
    const marker = `keep-${Date.now()}`;

    await fillScrollbackWithMarker(marker);
    expect(await readWithScrollback()).toContain(marker);

    await emitEraseScrollback();
    expect(await readWithScrollback()).toContain(marker);
  });

  it('live-toggle from ON to OFF takes effect on the same session', async () => {
    // Start in ON so we know the subscription is live; flip to OFF mid-session.
    await client.callTool('terminal_set_preserve_scrollback', { enabled: true });
    await client.callTool('terminal_set_preserve_scrollback', { enabled: false });

    const marker = `live-${Date.now()}`;
    await fillScrollbackWithMarker(marker);
    expect(await readWithScrollback()).toContain(marker);

    await emitEraseScrollback();
    expect(await readWithScrollback()).not.toContain(marker);
  });
});
