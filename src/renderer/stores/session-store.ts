import { create } from 'zustand';
import type { SessionInfo, ExternalSessionInfo, HookRuntimeInfo } from '@shared/types';

interface SessionState {
  sessions: Record<string, SessionInfo>;
  externalSessions: ExternalSessionInfo[];
  selectedSessionId: string | null;
  hookRuntime: HookRuntimeInfo;
  /** Exit codes keyed by sessionId. Populated by pty.onExit events. */
  exitCodes: Record<string, number>;

  addSession(session: SessionInfo): void;
  upsertSession(session: SessionInfo): void;
  removeSession(id: string): void;
  selectSession(id: string | null, source?: 'user' | 'system'): void;
  setLabel(id: string, label: string): void;
  setSessions(sessions: SessionInfo[]): void;
  setExternalSessions(sessions: ExternalSessionInfo[]): void;
  setHookRuntime(info: HookRuntimeInfo): void;
  setExitCode(sessionId: string, code: number): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  externalSessions: [],
  selectedSessionId: null,
  hookRuntime: { state: 'initializing', port: null, warning: null },
  exitCodes: {},

  addSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.sessionId]: session },
    })),

  upsertSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.sessionId]: session },
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
      };
    }),

  selectSession: (id, source = 'user') => {
    set({ selectedSessionId: id });
    // Clear attention on explicit user focus
    if (id && source === 'user') {
      window.mcode.sessions.clearAttention(id).catch(() => {});
    }
  },

  setLabel: (id, label) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
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
    set((state) => ({
      exitCodes: { ...state.exitCodes, [sessionId]: code },
    })),
}));
