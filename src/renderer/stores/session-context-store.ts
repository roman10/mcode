import { create } from 'zustand';
import type { CurrentContextUsage } from '@shared/types';

/**
 * Per-tile session context occupancy. Keyed by provider-native agent session
 * id — when a session is `/clear`ed, the new id has no entry yet and the badge
 * hides until the first new turn lands. Mounted components are responsible for
 * calling fetch() on mount + on agentSessionId change, and for triggering
 * refetch on `tokens:updated` push events while mounted.
 */
interface SessionContextState {
  byId: Record<string, CurrentContextUsage | null>;
  inflight: Set<string>;

  fetch(agentSessionId: string | null): Promise<void>;
}

export const useSessionContextStore = create<SessionContextState>((set, get) => ({
  byId: {},
  inflight: new Set(),

  fetch: async (agentSessionId: string | null): Promise<void> => {
    if (!agentSessionId) return;
    const { inflight } = get();
    if (inflight.has(agentSessionId)) return;

    const next = new Set(inflight);
    next.add(agentSessionId);
    set({ inflight: next });

    try {
      const usage = await window.mcode.tokens.getSessionUsage(agentSessionId);
      set((s) => ({
        byId: { ...s.byId, [agentSessionId]: usage.currentContext },
      }));
    } catch (err) {
      console.error('Failed to fetch session context:', err);
    } finally {
      const cur = new Set(get().inflight);
      cur.delete(agentSessionId);
      set({ inflight: cur });
    }
  },
}));
