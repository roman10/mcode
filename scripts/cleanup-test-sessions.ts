/**
 * Delete all test sessions and remove their tiles, terminal tabs, and sidebar entries.
 * Connects to the running mcode app's MCP server and calls app_reset_test_state.
 *
 * Usage: npx tsx scripts/cleanup-test-sessions.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env['MCODE_TEST_URL'] ?? 'http://127.0.0.1:7532/mcp';

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client({ name: 'cleanup-test-sessions', version: '0.1.0' });

  try {
    await client.connect(transport);
  } catch {
    console.error(`Cannot connect to mcode at ${MCP_URL}. Is the app running with MCP enabled?`);
    process.exit(1);
  }

  try {
    const result = await client.callTool({ name: 'app_reset_test_state', arguments: {} });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .find((c) => c.type === 'text')?.text ?? 'No response';
    console.log(text);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
