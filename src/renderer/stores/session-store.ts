import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { SessionInfo, ExternalSessionInfo, HookRuntimeInfo } from '@shared/types';

interface SessionState {
  sessions: Record<string, SessionInfo>;
  externalSessions: ExternalSessionInfo[];
  selectedSessionId: string | null;
  /**
   * Last-focused PTY session across any terminal surface (tile or bottom panel).
   * Used to route pty input like snippet insertion. Independent of
   * `selectedSessionId`, which is tile-scoped.
   */
  lastFocusedPtySessionId: string | null;
  hookRuntime: HookRuntimeInfo;
  /** Exit codes keyed by sessionId. Populated by pty.onExit events. */
  exitCodes: Record<string, number>;

  addSession(session: SessionInfo): void;
  upsertSession(session: SessionInfo): void;
  removeSession(id: string): void;
  selectSession(id: string | null, source?: 'user' | 'system'): void;
  setLastFocusedPtySession(id: string | null): void;
  setLabel(id: string, label: string): void;
  setSessions(sessions: SessionInfo[]): void;
  setExternalSessions(sessions: ExternalSessionInfo[]): void;
  setHookRuntime(info: HookRuntimeInfo): void;
  setExitCode(sessionId: string, code: number): void;
}

function sameTerminalConfig(a: SessionInfo['terminalConfig'], b: SessionInfo['terminalConfig']): boolean {
  return a?.scrollbackLines === b?.scrollbackLines;
}

function sameSessionInfo(a: SessionInfo, b: SessionInfo): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.label === b.label &&
    a.cwd === b.cwd &&
    a.status === b.status &&
    a.permissionMode === b.permissionMode &&
    a.effort === b.effort &&
    a.enableAutoMode === b.enableAutoMode &&
    a.allowBypassPermissions === b.allowBypassPermissions &&
    a.worktree === b.worktree &&
    a.startedAt === b.startedAt &&
    a.endedAt === b.endedAt &&
    a.claudeSessionId === b.claudeSessionId &&
    a.codexThreadId === b.codexThreadId &&
    a.geminiSessionId === b.geminiSessionId &&
    a.copilotSessionId === b.copilotSessionId &&
    a.lastTool === b.lastTool &&
    a.lastEventAt === b.lastEventAt &&
    a.attentionLevel === b.attentionLevel &&
    a.attentionReason === b.attentionReason &&
    a.hookMode === b.hookMode &&
    a.sessionType === b.sessionType &&
    sameTerminalConfig(a.terminalConfig, b.terminalConfig) &&
    a.accountId === b.accountId &&
    a.autoClose === b.autoClose &&
    a.model === b.model &&
    a.isTest === b.isTest
  );
}

function upsertSessionRecord(
  sessions: Record<string, SessionInfo>,
  session: SessionInfo,
): Record<string, SessionInfo> {
  const existing = sessions[session.sessionId];
  if (existing && sameSessionInfo(existing, session)) return sessions;
  return { ...sessions, [session.sessionId]: session };
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  externalSessions: [],
  selectedSessionId: null,
  lastFocusedPtySessionId: null,
  hookRuntime: { state: 'initializing', port: null, warning: null },
  exitCodes: {},

  addSession: (session) =>
    set((state) => ({
      sessions: upsertSessionRecord(state.sessions, session),
    })),

  upsertSession: (session) =>
    set((state) => ({
      sessions: upsertSessionRecord(state.sessions, session),
    })),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      const { [id]: _ec, ...exitCodesRest } = state.exitCodes;
      return {
        sessions: rest,
        exitCodes: exitCodesRest,
        selectedSessionId:
          state.selectedSessionId === id ? null : state.selectedSessionId,
        lastFocusedPtySessionId:
          state.lastFocusedPtySessionId === id ? null : state.lastFocusedPtySessionId,
      };
    }),

  selectSession: (id, source = 'user') => {
    set((state) => ({
      selectedSessionId: id,
      // Tile focus also routes pty input. On null (e.g. session removed),
      // keep the previous pty target — null here isn't a "stop routing" signal.
      lastFocusedPtySessionId: id ?? state.lastFocusedPtySessionId,
    }));
    // Clear attention on explicit user focus
    if (id && source === 'user') {
      window.mcode.sessions.clearAttention(id).catch(() => {});
    }
  },

  setLastFocusedPtySession: (id) => set({ lastFocusedPtySessionId: id }),

  setLabel: (id, label) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      if (existing.label === label) return state;
      return {
        sessions: { ...state.sessions, [id]: { ...existing, label } },
      };
    }),

  setSessions: (sessions) =>
    set({
      sessions: Object.fromEntries(
        sessions.map((s) => [s.sessionId, s]),
      ),
    }),

  setExternalSessions: (sessions) => set({ externalSessions: sessions }),

  setHookRuntime: (info) => set({ hookRuntime: info }),

  setExitCode: (sessionId, code) =>
    set((state) => {
      if (state.exitCodes[sessionId] === code) return state;
      return {
        exitCodes: { ...state.exitCodes, [sessionId]: code },
      };
    }),
}));

/**
 * Subscribe to a single session by id. Rerenders only when that session's
 * reference changes — `upsertSession` preserves references for non-updated
 * entries, so updates to other sessions don't trigger a rerender here.
 */
export const useSession = (id: string | null | undefined): SessionInfo | undefined =>
  useSessionStore((s) => (id ? s.sessions[id] : undefined));

/**
 * Subscribe to the set of session ids. Rerenders only when sessions are added
 * or removed (shallow array comparison). For per-row data, pair this with
 * `useSession(id)` inside each row component.
 */
export const useSessionIds = (): string[] =>
  useSessionStore(useShallow((s) => Object.keys(s.sessions)));

/**
 * Subscribe to the entire sessions Record. Escape hatch for consumers that
 * genuinely need to iterate every session per render (filters, search). Hot-
 * path components should prefer `useSession` / `useSessionIds`.
 */
export const useAllSessions = (): Record<string, SessionInfo> =>
  useSessionStore((s) => s.sessions);
