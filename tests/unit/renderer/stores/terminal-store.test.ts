import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupMcodeMock } from '../mock-mcode';

setupMcodeMock();

const { useTerminalStore } = await import(
  '../../../../src/renderer/stores/terminal-store'
);

describe('terminal-store', () => {
  beforeEach(() => {
    useTerminalStore.setState({ preserveScrollback: false });
    (window.mcode.preferences.get as ReturnType<typeof vi.fn>).mockReset();
    (window.mcode.preferences.set as ReturnType<typeof vi.fn>).mockReset();
    (window.mcode.preferences.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('starts with preserveScrollback false', () => {
    expect(useTerminalStore.getState().preserveScrollback).toBe(false);
  });

  describe('setPreserveScrollback', () => {
    it('updates state and writes the pref', async () => {
      useTerminalStore.getState().setPreserveScrollback(true);
      expect(useTerminalStore.getState().preserveScrollback).toBe(true);
      expect(window.mcode.preferences.set).toHaveBeenCalledWith(
        'terminalPreserveScrollback',
        'true',
      );
    });

    it('rolls back state on IPC failure', async () => {
      (window.mcode.preferences.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('boom'),
      );
      useTerminalStore.getState().setPreserveScrollback(true);
      expect(useTerminalStore.getState().preserveScrollback).toBe(true);
      // Wait a tick for the catch handler to run.
      await new Promise((r) => setTimeout(r, 0));
      expect(useTerminalStore.getState().preserveScrollback).toBe(false);
    });
  });

  describe('load', () => {
    it('hydrates from "true"', async () => {
      (window.mcode.preferences.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('true');
      await useTerminalStore.getState().load();
      expect(useTerminalStore.getState().preserveScrollback).toBe(true);
    });

    it('hydrates from "false"', async () => {
      useTerminalStore.setState({ preserveScrollback: true });
      (window.mcode.preferences.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('false');
      await useTerminalStore.getState().load();
      expect(useTerminalStore.getState().preserveScrollback).toBe(false);
    });

    it('leaves the default in place when the pref is unset (null)', async () => {
      (window.mcode.preferences.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      await useTerminalStore.getState().load();
      expect(useTerminalStore.getState().preserveScrollback).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('notifies subscribers when the flag flips', () => {
      const listener = vi.fn();
      const unsub = useTerminalStore.subscribe((s, prev) => {
        if (s.preserveScrollback !== prev.preserveScrollback) listener(s.preserveScrollback);
      });
      useTerminalStore.getState().setPreserveScrollback(true);
      useTerminalStore.getState().setPreserveScrollback(false);
      unsub();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, true);
      expect(listener).toHaveBeenNthCalledWith(2, false);
    });
  });
});
