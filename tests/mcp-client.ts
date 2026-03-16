import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

const DEFAULT_URL = 'http://127.0.0.1:7532/mcp';

export class McpTestClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  async connect(url?: string): Promise<void> {
    this.transport = new StreamableHTTPClientTransport(
      new URL(url ?? DEFAULT_URL),
    );
    this.client = new Client({
      name: 'mcode-test-client',
      version: '0.1.0',
    });
    await this.client.connect(this.transport);
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!this.client) throw new Error('Not connected');
    const result = await this.client.callTool({ name, arguments: args });
    return result as ToolResult;
  }

  async callToolJson<T>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.callTool(name, args);
    if (result.isError) {
      const text = result.content.find((c) => c.type === 'text')?.text ?? 'Unknown error';
      throw new Error(text);
    }
    const textContent = result.content.find((c) => c.type === 'text');
    if (!textContent?.text) {
      throw new Error('No text content in response');
    }
    return JSON.parse(textContent.text) as T;
  }

  async callToolText(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.callTool(name, args);
    if (result.isError) {
      const text = result.content.find((c) => c.type === 'text')?.text ?? 'Unknown error';
      throw new Error(text);
    }
    return result.content.find((c) => c.type === 'text')?.text ?? '';
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}
