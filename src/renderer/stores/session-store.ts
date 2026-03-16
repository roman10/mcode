import { create } from 'zustand';
import type { SessionInfo, SessionStatus } from '../../shared/types';

interface SessionState {
  sessions: Record<string, SessionInfo>;
  selectedSessionId: string | null;

  addSession(session: SessionInfo): void;
  updateStatus(id: string, status: SessionStatus): void;
  removeSession(id: string): void;
  selectSession(id: string | null): void;
  setLabel(id: string, label: string): void;
  setSessions(sessions: SessionInfo[]): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  selectedSessionId: null,

  addSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.sessionId]: session },
    })),

  updateStatus: (id, status) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            status,
            endedAt:
              status === 'ended'
                ? new Date().toISOString()
                : existing.endedAt,
          },
        },
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      return {
        sessions: rest,
        selectedSessionId:
          state.selectedSessionId === id ? null : state.selectedSessionId,
      };
    }),

  selectSession: (id) => set({ selectedSessionId: id }),

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
}));
