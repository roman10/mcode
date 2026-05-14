import { useEffect, useState } from 'react';
import { HIDDEN_TILE_DISPOSE_MS } from '@shared/constants';
import { registerDisposeHiddenTile } from '../devtools/terminal-registry';

/**
 * Drives the Terminal mount/unmount lifecycle for a hidden-then-revealed tile.
 *
 * When `isVisible` flips to false, schedules disposal after
 * `HIDDEN_TILE_DISPOSE_MS` so the xterm instance and its scrollback are
 * freed (a long-running session can hold tens of MB). On reveal, flips back
 * to true synchronously so the parent remounts immediately. A devtools hook
 * is registered so integration tests can trigger the dispose path without
 * waiting the full 5 minutes.
 */
export function useTerminalDispose(isVisible: boolean, sessionId: string): boolean {
  const [shouldMount, setShouldMount] = useState(isVisible);

  useEffect(() => {
    if (isVisible) {
      setShouldMount(true);
      return;
    }
    const timer = window.setTimeout(() => setShouldMount(false), HIDDEN_TILE_DISPOSE_MS);
    const unregister = registerDisposeHiddenTile(sessionId, () => {
      window.clearTimeout(timer);
      setShouldMount(false);
      return true;
    });
    return () => {
      window.clearTimeout(timer);
      unregister();
    };
  }, [isVisible, sessionId]);

  return shouldMount;
}
