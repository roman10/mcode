import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [,, name = 'snapshot.png'] = process.argv;

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7532/mcp'));
  const client = new Client({ name: 'snap', version: '0.1.0' });
  await client.connect(transport);
  const r = await client.callTool({ name: 'window_screenshot', arguments: {} }) as any;
  const img = r.content?.find((c: any) => c.type === 'image');
  if (img?.data) {
    const out = join(process.cwd(), 'docs', 'screenshots', name);
    writeFileSync(out, Buffer.from(img.data, 'base64'));
    console.log(`saved: docs/screenshots/${name}`);
  } else {
    console.error('no image', r);
  }
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
