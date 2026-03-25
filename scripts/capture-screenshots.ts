/**
 * Screenshot capture script for README documentation.
 * Works with the production app (MCP enabled in Settings > Advanced) or the dev app.
 *
 * Usage: npx tsx scripts/capture-screenshots.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = 'http://127.0.0.1:7532/mcp';
const OUT_DIR = join(process.cwd(), 'docs', 'screenshots');

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const c = new Client_();
  const createdSessions: string[] = [];

  try {
    console.log('Connecting to MCP server…');
    await c.connect();
    console.log('Connected.\n');

    // Resize to a good screenshot size
    await c.call('window_resize', { width: 1440, height: 900 });
    await sleep(300);

    // Ensure sidebar is expanded
    await c.call('layout_set_sidebar_collapsed', { collapsed: false });
    await sleep(200);

    // -------------------------------------------------------------------------
    // 1. Sessions sidebar — capture historical sessions list first
    // -------------------------------------------------------------------------
    console.log('Taking sessions sidebar screenshot…');
    await c.call('layout_set_view_mode', { mode: 'tiles' });
    await c.call('layout_remove_all_tiles');
    await c.call('sidebar_set_session_filter', { query: '' });
    await c.call('sidebar_switch_tab', { tab: 'sessions' });
    await sleep(600);
    save('sessions-sidebar.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 2. Stats sidebar
    // -------------------------------------------------------------------------
    console.log('\nTaking stats sidebar screenshot…');
    await c.call('sidebar_switch_tab', { tab: 'stats' });
    await sleep(600);
    save('stats-sidebar.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 3. Changes sidebar
    // -------------------------------------------------------------------------
    console.log('\nTaking changes sidebar screenshot…');
    await c.call('sidebar_switch_tab', { tab: 'changes' });
    await sleep(600);
    save('changes-sidebar.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // Create real Claude sessions for tiling + kanban screenshots
    // -------------------------------------------------------------------------
    console.log('\nCreating sessions for tiling/kanban screenshots…');
    const sessionDefs = [
      { label: 'auth-refactor', cwd: process.cwd() },
      { label: 'api-endpoints', cwd: process.cwd() },
      { label: 'write-tests', cwd: process.cwd() },
      { label: 'fix-ci', cwd: process.cwd() },
    ];

    for (const def of sessionDefs) {
      const s = await c.callJson<{ sessionId: string }>('session_create', def);
      createdSessions.push(s.sessionId);
      // Add tile immediately so the terminal connects to the PTY and captures output
      await c.call('layout_add_tile', { sessionId: s.sessionId });
      await sleep(150);
    }

    // Wait for Claude to initialize and show its startup UI
    console.log('Waiting for sessions to initialize…');
    await sleep(4000);

    // -------------------------------------------------------------------------
    // 4. Tiling layout
    // -------------------------------------------------------------------------
    console.log('\nTaking tiling layout screenshot…');
    await c.call('layout_set_view_mode', { mode: 'tiles' });
    await c.call('sidebar_switch_tab', { tab: 'sessions' });
    await sleep(600);
    save('tiling-layout.png', await c.screenshot());

    // -------------------------------------------------------------------------
    // 5. Kanban view
    // -------------------------------------------------------------------------
    console.log('\nSwitching to kanban view…');
    await c.call('layout_set_view_mode', { mode: 'kanban' });
    await sleep(600);
    save('kanban-view.png', await c.screenshot());

    // Expand one session in kanban
    await c.call('kanban_expand_session', { sessionId: createdSessions[0] });
    await sleep(500);
    save('kanban-expanded.png', await c.screenshot());

    console.log('\nDone. Screenshots saved to docs/screenshots/');

  } finally {
    // Clean up created sessions and tiles
    console.log('\nCleaning up…');
    for (const id of createdSessions) {
      try { await c.call('session_kill', { sessionId: id }); } catch { /* best-effort */ }
    }
    try { await c.call('layout_remove_all_tiles'); } catch { /* best-effort */ }

    await c.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
