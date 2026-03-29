import { create } from 'zustand';

const DISMISS_KEY = 'update-dismissed-version';

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;

  /** Version the user explicitly dismissed (persisted to sessionStorage). */
  dismissedVersion: string | null;
  /** Whether the user closed the "ready" banner this session. Resets on version change. */
  bannerDismissed: boolean;

  setAvailable(version: string): void;
  setDownloading(version: string, percent: number): void;
  setReady(version: string): void;
  setError(message: string): void;
  dismissVersion(version: string): void;
  dismissBanner(): void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  phase: 'idle',
  version: null,
  percent: 0,
  errorMessage: null,
  dismissedVersion: sessionStorage.getItem(DISMISS_KEY),
  bannerDismissed: false,

  setAvailable: (version) =>
    set((s) => ({
      phase: 'available',
      version,
      percent: 0,
      errorMessage: null,
      // Reset banner dismiss when a new version arrives
      bannerDismissed: s.version === version ? s.bannerDismissed : false,
    })),

  setDownloading: (version, percent) =>
    set((s) => {
      if (s.phase !== 'available' && s.phase !== 'downloading') return s;
      return { phase: 'downloading', version, percent };
    }),

  setReady: (version) =>
    set((s) => ({
      phase: 'ready',
      version,
      percent: 100,
      errorMessage: null,
      bannerDismissed: s.version === version ? s.bannerDismissed : false,
    })),

  setError: (message) =>
    set((s) => {
      if (s.phase === 'idle') return s;
      return { phase: 'error', errorMessage: message };
    }),

  dismissVersion: (version) => {
    sessionStorage.setItem(DISMISS_KEY, version);
    set({ phase: 'idle', dismissedVersion: version });
  },

  dismissBanner: () => set({ bannerDismissed: true }),
}));
