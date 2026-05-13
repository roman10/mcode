import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyExitPayload } from '../../../../src/shared/types';

type OnDataHandler = (sessionId: string, data: string) => void;
type OnExitHandler = (sessionId: string, payload: PtyExitPayload) => void;

describe('pty-subscriptions', () => {
  let onData: ReturnType<typeof vi.fn>;
  let onExit: ReturnType<typeof vi.fn>;
  let offData: ReturnType<typeof vi.fn>;
  let offExit: ReturnType<typeof vi.fn>;
  let onDataHandler: OnDataHandler | null;
  let onExitHandler: OnExitHandler | null;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    onDataHandler = null;
    onExitHandler = null;
    offData = vi.fn();
    offExit = vi.fn();
    onData = vi.fn((cb: OnDataHandler) => {
      onDataHandler = cb;
      return offData;
    });
    onExit = vi.fn((cb: OnExitHandler) => {
      onExitHandler = cb;
      return offExit;
    });
    vi.stubGlobal('window', {
      mcode: {
        pty: {
          onData,
          onExit,
        },
      },
    });
  });

  it('demultiplexes pty:data by session while keeping a single global subscription', async () => {
    const { subscribeToPtyData } = await import('../../../../src/renderer/utils/pty-subscriptions');
    const sessionOneA = vi.fn();
    const sessionOneB = vi.fn();
    const sessionTwo = vi.fn();

    const unsubA = subscribeToPtyData('s1', sessionOneA);
    const unsubB = subscribeToPtyData('s1', sessionOneB);
    const unsubTwo = subscribeToPtyData('s2', sessionTwo);

    expect(onData).toHaveBeenCalledTimes(1);

    onDataHandler?.('s1', 'hello');
    expect(sessionOneA).toHaveBeenCalledWith('hello');
    expect(sessionOneB).toHaveBeenCalledWith('hello');
    expect(sessionTwo).not.toHaveBeenCalled();

    unsubA();
    unsubB();
    expect(offData).not.toHaveBeenCalled();

    unsubTwo();
    expect(offData).toHaveBeenCalledTimes(1);
  });

  it('demultiplexes pty:exit by session while keeping a single global subscription', async () => {
    const { subscribeToPtyExit } = await import('../../../../src/renderer/utils/pty-subscriptions');
    const exitOne = vi.fn();
    const exitTwo = vi.fn();

    const unsubOne = subscribeToPtyExit('s1', exitOne);
    const unsubTwo = subscribeToPtyExit('s2', exitTwo);

    expect(onExit).toHaveBeenCalledTimes(1);

    onExitHandler?.('s2', { code: 130, signal: 2 });
    expect(exitOne).not.toHaveBeenCalled();
    expect(exitTwo).toHaveBeenCalledWith({ code: 130, signal: 2 });

    unsubOne();
    expect(offExit).not.toHaveBeenCalled();

    unsubTwo();
    expect(offExit).toHaveBeenCalledTimes(1);
  });
});
