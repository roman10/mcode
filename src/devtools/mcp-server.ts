import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerSessionTools } from './tools/session-tools';
import { registerWindowTools } from './tools/window-tools';
import { registerTerminalTools } from './tools/terminal-tools';
import { registerAppTools } from './tools/app-tools';
import { registerLayoutTools } from './tools/layout-tools';
import { registerHookTools } from './tools/hook-tools';
import { registerTaskTools } from './tools/task-tools';
import { registerCommitTools } from './tools/commit-tools';
import { registerGitTools } from './tools/git-tools';
import { registerFileTools } from './tools/file-tools';
import { registerTokenTools } from './tools/token-tools';
import { registerSearchTools } from './tools/search-tools';
import { registerSnippetTools } from './tools/snippet-tools';
import { registerTestTools } from './tools/test-tools';
import type { McpServerContext } from './types';

const DEFAULT_PORT = 7532;

function createServer(ctx: McpServerContext): McpServer {
  const server = new McpServer({
    name: ctx.mode === 'dev' ? 'mcode-devtools' : 'mcode',
    version: '0.1.0',
  });

  registerSessionTools(server, ctx);
  registerWindowTools(server, ctx);
  registerTerminalTools(server, ctx);
  registerAppTools(server, ctx);
  registerLayoutTools(server, ctx);
  registerHookTools(server, ctx);
  registerTaskTools(server, ctx);
  registerCommitTools(server, ctx);
  registerGitTools(server, ctx);
  registerFileTools(server, ctx);
  registerTokenTools(server, ctx);
  registerSearchTools(server, ctx);
  registerSnippetTools(server);

  if (ctx.mode === 'dev') {
    registerTestTools(server, ctx);
  }

  return server;
}

export async function startMcpServer(ctx: McpServerContext): Promise<void> {
  // Each MCP session gets its own McpServer + transport pair
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function handlePost(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Existing session
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      // New session — create server + transport pair
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      const server = createServer(ctx);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // Invalid: no session ID and not an init request
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID' },
        id: null,
      }),
    );
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/mcp') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      if (req.method === 'POST') {
        // Parse body for POST requests
        const body = await new Promise<unknown>((resolve, reject) => {
          let data = '';
          req.on('data', (chunk) => (data += chunk));
          req.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('Invalid JSON'));
            }
          });
          req.on('error', reject);
        });
        await handlePost(req, res, body);
      } else if (req.method === 'GET') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res);
        } else {
          res.writeHead(400);
          res.end('Invalid or missing session ID');
        }
      } else if (req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res);
        } else {
          res.writeHead(404);
          res.end('Session not found');
        }
      } else {
        res.writeHead(405);
        res.end('Method not allowed');
      }
    } catch (err) {
      console.error('[mcode-devtools] Error handling request:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
    }
  });

  const port = parseInt(
    process.env['MCODE_MCP_PORT'] || String(DEFAULT_PORT),
    10,
  );

  httpServer.listen(port, '127.0.0.1', () => {
    console.log(
      `[mcode-devtools] MCP server listening on http://127.0.0.1:${port}/mcp`,
    );
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[mcode-devtools] Port ${port} in use. Set MCODE_MCP_PORT env var to use a different port.`,
      );
    } else {
      console.error('[mcode-devtools] Server error:', err);
    }
  });
}
