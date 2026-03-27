import type {
  ExternalSessionInfo,
  LayoutStateSnapshot,
  SessionCreateInput,
  SessionDefaults,
  SessionInfo,
} from './types';

// ---------------------------------------------------------------------------
// Session + Layout domain IPC channels
// ---------------------------------------------------------------------------

export interface SessionInvokeContract {
  'session:create':                     { params: [input: SessionCreateInput]; result: SessionInfo };
  'session:list':                       { params: []; result: SessionInfo[] };
  'session:get':                        { params: [sessionId: string]; result: SessionInfo | null };
  'session:kill':                       { params: [sessionId: string]; result: void };
  'session:delete':                     { params: [sessionId: string]; result: void };
  'session:delete-all-ended':           { params: []; result: string[] };
  'session:delete-batch':               { params: [sessionIds: string[]]; result: string[] };
  'session:get-last-defaults':          { params: []; result: SessionDefaults | null };
  'session:set-label':                  { params: [sessionId: string, label: string]; result: void };
  'session:set-auto-label':             { params: [sessionId: string, label: string]; result: void };
  'session:set-auto-close':             { params: [sessionId: string, value: boolean]; result: void };
  'session:set-terminal-config':        { params: [sessionId: string, config: Record<string, unknown>]; result: void };
  'session:clear-attention':            { params: [sessionId: string]; result: void };
  'session:clear-all-attention':        { params: []; result: void };
  'session:resume':                     { params: [opts: { sessionId: string; accountId?: string }]; result: SessionInfo };
  'session:list-external':              { params: [limit?: number]; result: ExternalSessionInfo[] };
  'session:import-external':            { params: [claudeSessionId: string, cwd: string, label?: string]; result: SessionInfo };

  'layout:save':                        { params: [mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string, terminalPanelState?: unknown]; result: void };
  'layout:load':                        { params: []; result: LayoutStateSnapshot | null };
}

export interface SessionPushContract {
  'session:created':                    { params: [session: SessionInfo] };
  'session:updated':                    { params: [session: SessionInfo] };
  'session:deleted':                    { params: [sessionId: string] };
  'session:deleted-batch':              { params: [sessionIds: string[]] };
}
