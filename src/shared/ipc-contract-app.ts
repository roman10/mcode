import type {
  AccountProfile,
  AppCommand,
  AuthStatusResult,
  CreateTaskInput,
  HookEvent,
  HookRuntimeInfo,
  SubscriptionUsage,
  Task,
  TaskChangeEvent,
  TaskFilter,
  UpdateTaskInput,
} from './types';

// ---------------------------------------------------------------------------
// App, Preferences, Hooks, Accounts, and Tasks IPC channels
// ---------------------------------------------------------------------------

export interface AppInvokeContract {
  // --- App ---
  'app:get-version':                    { params: []; result: string };
  'app:select-directory':               { params: []; result: string | null };
  'app:check-for-update':              { params: []; result: void };
  'app:open-update-page':               { params: []; result: void };
  'app:download-update':                { params: []; result: void };
  'app:install-update':                 { params: []; result: void };

  // --- Tasks ---
  'task:create':                        { params: [input: CreateTaskInput]; result: Task };
  'task:list':                          { params: [filter?: TaskFilter]; result: Task[] };
  'task:update':                        { params: [taskId: number, input: UpdateTaskInput]; result: Task };
  'task:cancel':                        { params: [taskId: number]; result: void };
  'task:reorder':                       { params: [taskId: number, direction: 'up' | 'down']; result: Task };

  // --- Preferences ---
  'preferences:get':                    { params: [key: string]; result: string | null };
  'preferences:set':                    { params: [key: string, value: string]; result: void };
  'preferences:get-sleep-status':       { params: []; result: { enabled: boolean; blocking: boolean } };
  'preferences:set-prevent-sleep':      { params: [enabled: boolean]; result: void };

  // --- Hooks ---
  'hooks:get-runtime':                  { params: []; result: HookRuntimeInfo };
  'hooks:get-recent':                   { params: [sessionId: string, limit?: number]; result: HookEvent[] };
  'hooks:get-recent-all':               { params: [limit?: number]; result: HookEvent[] };
  'hooks:clear-all':                    { params: []; result: void };

  // --- Accounts ---
  'account:list':                       { params: []; result: AccountProfile[] };
  'account:create':                     { params: [name?: string]; result: AccountProfile };
  'account:rename':                     { params: [accountId: string, name: string]; result: void };
  'account:delete':                     { params: [accountId: string]; result: void };
  'account:get-auth-status':            { params: [accountId: string]; result: AuthStatusResult };
  'account:check-cli-installed':        { params: []; result: AuthStatusResult };
  'account:open-auth-terminal':         { params: [accountId: string]; result: string };
  'account:get-subscription-usage':     { params: [accountId: string, forceRefresh?: boolean]; result: SubscriptionUsage | null };
}

export interface AppSendContract {
  'app:set-dock-badge':                 { params: [text: string] };
}

export interface AppPushContract {
  'hook:event':                         { params: [event: HookEvent] };
  'task:changed':                       { params: [event: TaskChangeEvent] };
  'app:command':                        { params: [command: AppCommand] };
  'app:error':                          { params: [error: string] };
  'app:update-available':               { params: [info: { version: string }] };
  'app:update-download-progress':       { params: [info: { percent: number }] };
  'app:update-downloaded':              { params: [info: { version: string }] };
  'app:update-error':                   { params: [info: { message: string }] };
  'devtools:query':                     { params: [requestId: string, type: string, params: Record<string, unknown>] };
}
