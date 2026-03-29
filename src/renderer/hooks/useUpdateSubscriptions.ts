import { useEffect } from 'react';
import { useUpdateStore } from '../stores/update-store';

/**
 * Registers IPC push subscriptions for auto-update events.
 * Dispatches into the shared update store so any component can react.
 * Call once in App.tsx.
 */
export function useUpdateSubscriptions(): void {
  useEffect(() => {
    const unsub1 = window.mcode.app.onUpdateAvailable((info) => {
      useUpdateStore.getState().setAvailable(info.version);
    });
    const unsub2 = window.mcode.app.onUpdateDownloadProgress((info) => {
      const state = useUpdateStore.getState();
      if (state.version) {
        state.setDownloading(state.version, info.percent);
      }
    });
    const unsub3 = window.mcode.app.onUpdateDownloaded((info) => {
      useUpdateStore.getState().setReady(info.version);
    });
    const unsub4 = window.mcode.app.onUpdateError((info) => {
      useUpdateStore.getState().setError(info.message);
    });
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, []);
}
