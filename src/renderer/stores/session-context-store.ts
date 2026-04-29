import { create } from 'zustand';
import type { CurrentContextUsage } from '@shared/types';

/**
 * Per-tile session context occupancy. Keyed by claudeSessionId — when a
 * session is `/clear`ed, the new id has no entry yet and the badge hides
 * until the first new turn lands. Mounted components are responsible for
 * calling fetch() on mount + on claudeSessionId change, and for triggering
 * refetch on `tokens:updated` push events while mounted.
 */
interface SessionContextState {
  byId: Record<string, CurrentContextUsage | null>;
  inflight: Set<string>;

  fetch(claudeSessionId: string | null): Promise<void>;
}

export const useSessionContextStore = create<SessionContextState>((set, get) => ({
  byId: {},
  inflight: new Set(),

  fetch: async (claudeSessionId: string | null): Promise<void> => {
    if (!claudeSessionId) return;
    const { inflight } = get();
    if (inflight.has(claudeSessionId)) return;

    const next = new Set(inflight);
    next.add(claudeSessionId);
    set({ inflight: next });

    try {
      const usage = await window.mcode.tokens.getSessionUsage(claudeSessionId);
      set((s) => ({
        byId: { ...s.byId, [claudeSessionId]: usage.currentContext },
      }));
    } catch (err) {
      console.error('Failed to fetch session context:', err);
    } finally {
      const cur = new Set(get().inflight);
      cur.delete(claudeSessionId);
      set({ inflight: cur });
    }
  },
}));
