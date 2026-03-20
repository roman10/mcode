import http from 'node:http';
import { logger } from './logger';
import {
  HOOK_PORT_DEFAULT,
  HOOK_PORT_MAX,
  HOOK_TOOL_INPUT_MAX_BYTES,
  KNOWN_HOOK_EVENTS,
} from '../shared/constants';
import type { HookRuntimeInfo, HookEvent } from '../shared/types';

type HookEventCallback = (sessionId: string, event: HookEvent) => boolean;
type SessionLookup = (claudeSessionId: string) => string | null;

let httpServer: http.Server | null = null;

function truncateToolInput(
  input: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!input) return null;
  const json = JSON.stringify(input);
  if (json.length <= HOOK_TOOL_INPUT_MAX_BYTES) return input;
  // Truncate by returning a summary
  return { _truncated: true, _originalLength: json.length };
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
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
}

function tryBindPort(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export async function startHookServer(
  onEvent: HookEventCallback,
  lookupByClaudeSessionId: SessionLookup,
): Promise<HookRuntimeInfo> {
  // Try ports in range
  for (let port = HOOK_PORT_DEFAULT; port <= HOOK_PORT_MAX; port++) {
    try {
      const server = await tryBindPort(port);
      httpServer = server;

      // Wire up request handling
      server.on('request', async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/hook') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        try {
          const body = await parseBody(req);
          handleHookPost(req, res, body as Record<string, unknown>, onEvent, lookupByClaudeSessionId);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });

      logger.info('hook-server', `Listening on port ${port}`);
      return { state: 'ready', port, warning: null };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        logger.warn('hook-server', `Port ${port} in use, trying next`);
        continue;
      }
      // Unexpected error — stop trying
      logger.error('hook-server', `Failed to bind port ${port}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  return {
    state: 'degraded',
    port: null,
    warning: `All ports ${HOOK_PORT_DEFAULT}-${HOOK_PORT_MAX} unavailable`,
  };
}

function handleHookPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Record<string, unknown>,
  onEvent: HookEventCallback,
  lookupByClaudeSessionId: SessionLookup,
): void {
  // Validate hook_event_name
  const hookEventName = body.hook_event_name as string | undefined;
  if (!hookEventName || !(KNOWN_HOOK_EVENTS as readonly string[]).includes(hookEventName)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Invalid or missing hook_event_name: ${hookEventName}` }));
    return;
  }

  // Resolve internal session ID
  const headerSessionId = req.headers['x-mcode-session-id'] as string | undefined;
  const claudeSessionId = body.session_id as string | undefined;

  let sessionId = headerSessionId ?? null;
  if (!sessionId && claudeSessionId) {
    sessionId = lookupByClaudeSessionId(claudeSessionId);
  }

  if (!sessionId) {
    // Return 200 so external Claude Code sessions and other mcode instances
    // don't see hook errors — we simply have no opinion about this session.
    logger.debug('hook-server', 'Ignoring hook from uncorrelated session', { hookEventName });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }

  // Build HookEvent
  const event: HookEvent = {
    sessionId,
    claudeSessionId: claudeSessionId ?? null,
    hookEventName,
    toolName: (body.tool_name as string) ?? null,
    toolInput: truncateToolInput((body.tool_input as Record<string, unknown>) ?? null),
    createdAt: new Date().toISOString(),
    payload: body,
  };

  try {
    const accepted = onEvent(sessionId, event);
    if (!accepted) {
      // Session ID was provided but not found in DB — likely from another
      // mcode instance or a race (session deleted while hook arrived).
      logger.debug('hook-server', 'Hook event not accepted (session not found)', {
        sessionId,
        hookEventName,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
  } catch (err) {
    logger.error('hook-server', 'Error processing hook event', {
      sessionId,
      hookEventName,
      error: err instanceof Error ? err.message : String(err),
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to process hook event' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
}

export function stopHookServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    logger.info('hook-server', 'Stopped');
  }
}
