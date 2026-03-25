/**
 * Screenshot capture script for README documentation.
 * Requires the dev app to be running (npm run dev).
 *
 * Usage: npx tsx scripts/capture-screenshots.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = 'http://127.0.0.1:7532/mcp';
const OUT_DIR = join(process.cwd(), 'docs', 'screenshots');
const TEST_CLAUDE = join(process.cwd(), 'tests', 'fixtures', 'claude');

mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

class Client_ {
  private client: Client | null = null;

  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
    this.client = new Client({ name: 'screenshot-script', version: '0.1.0' });
    await this.client.connect(transport);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) throw new Error('Not connected');
    return this.client.callTool({ name, arguments: args });
  }

  async callJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = (await this.call(name, args)) as { content: Array<{ type: string; text?: string }> };
    const text = result.content.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error(`No text response from ${name}`);
    return JSON.parse(text) as T;
  }

  async callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = (await this.call(name, args)) as { content: Array<{ type: string; text?: string }> };
    return result.content.find((c) => c.type === 'text')?.text ?? '';
  }

  async screenshot(): Promise<Buffer | null> {
    const result = (await this.call('window_screenshot')) as {
      isError?: boolean;
      content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
    };
    if (result.isError) {
      console.warn('Screenshot failed:', result.content.find((c) => c.type === 'text')?.text);
      return null;
    }
    const img = result.content.find((c) => c.type === 'image');
    if (!img?.data) return null;
    return Buffer.from(img.data, 'base64');
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function save(name: string, buf: Buffer | null): void {
  if (!buf) { console.log(`  ⚠ skipped (no data): ${name}`); return; }
  const path = join(OUT_DIR, name);
  writeFileSync(path, buf);
  console.log(`  ✓ saved: docs/screenshots/${name}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function createSession(
  c: Client_,
  label: string,
  overrides: Record<string, unknown> = {},
): Promise<{ sessionId: string }> {
  return c.callJson('session_create', {
    cwd: process.cwd(),
    command: TEST_CLAUDE,
    label,
    ...overrides,
  });
}

async function injectHook(c: Client_, sessionId: string, event: string, opts: Record<string, unknown> = {}): Promise<void> {
  await c.callJson('hook_inject_event', { sessionId, hookEventName: event, ...opts });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const c = new Client_();

  try {
    console.log('Connecting to MCP server…');
    await c.connect();
    console.log('Connected.\n');

    // Clean slate
    await c.call('app_reset_test_state');
    await sleep(500);

    // Resize to a good screenshot size
    await c.call('window_resize', { width: 1440, height: 900 });
    await sleep(300);

    // -------------------------------------------------------------------------
    // 1. Tiling layout — 4 sessions with mixed states
    // -------------------------------------------------------------------------
    console.log('Setting up tiling layout…');
    await c.call('layout_set_view_mode', { mode: 'tiles' });

    const labels = [
      'auth-refactor',
      'api-endpoints',
      'write-tests',
      'fix-ci',
    ];

    const sessionIds: string[] = [];
    for (const label of labels) {
      const s = await createSession(c, label);
      sessionIds.push(s.sessionId);
      await sleep(200);
    }

    // Simulate different states via hook injection
    const [s1, s2, s3, s4] = sessionIds;

    // s1: active (working)
    await injectHook(c, s1, 'SessionStart');
    await injectHook(c, s1, 'PreToolUse', { toolName: 'Bash' });

    // s2: needs attention (permission request)
    await injectHook(c, s2, 'SessionStart');
    await injectHook(c, s2, 'PermissionRequest', { toolName: 'Bash' });

    // s3: active
    await injectHook(c, s3, 'SessionStart');
    await injectHook(c, s3, 'PreToolUse', { toolName: 'Read' });

    // s4: idle (completed)
    await injectHook(c, s4, 'SessionStart');
    await injectHook(c, s4, 'Stop');

    await sleep(800);
    console.log('Taking tiling layout screenshot…');
    save('tiling-layout.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 2. Kanban view
    // -------------------------------------------------------------------------
    console.log('\nSwitching to kanban view…');
    await c.call('layout_set_view_mode', { mode: 'kanban' });
    await sleep(600);
    save('kanban-view.png', await c.screenshot());

    // Expand one session in kanban
    await c.call('kanban_expand_session', { sessionId: s1 });
    await sleep(500);
    save('kanban-expanded.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 3. Commit analytics sidebar
    // -------------------------------------------------------------------------
    console.log('\nSwitching to stats sidebar…');
    await c.call('layout_set_view_mode', { mode: 'tiles' });
    await c.call('sidebar_switch_tab', { tab: 'stats' });
    await sleep(500);
    save('stats-sidebar.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 4. Changes/git sidebar
    // -------------------------------------------------------------------------
    console.log('\nSwitching to changes sidebar…');
    await c.call('sidebar_switch_tab', { tab: 'changes' });
    await sleep(500);
    save('changes-sidebar.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 5. Sessions sidebar (default state)
    // -------------------------------------------------------------------------
    console.log('\nSwitching back to sessions sidebar…');
    await c.call('sidebar_switch_tab', { tab: 'sessions' });
    await sleep(500);
    save('sessions-sidebar.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // Clean up
    // -------------------------------------------------------------------------
    for (const id of sessionIds) {
      try { await c.call('session_kill', { sessionId: id }); } catch { /* best-effort */ }
    }

    console.log('\nDone. Screenshots saved to docs/screenshots/');

  } finally {
    await c.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
