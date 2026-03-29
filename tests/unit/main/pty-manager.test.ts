import { describe, it, expect, vi } from 'vitest';
import { PtyManager } from '../../../src/main/pty/pty-manager';
import * as pty from 'node-pty';

vi.mock('node-pty', () => ({
  spawn: vi.fn().mockReturnValue({
    onData: vi.fn(),
    onExit: vi.fn(),
    pid: 123,
  }),
}));

describe('PtyManager', () => {
  it('includes COLORTERM and TERM_PROGRAM in the environment', () => {
    const manager = new PtyManager(vi.fn(), vi.fn());
    
    manager.spawn({
      id: 'test-id',
      command: 'bash',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    });

    expect(pty.spawn).toHaveBeenCalledWith(
      'bash',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'mcode',
        }),
      })
    );
  });

  it('allows overrides of environment variables', () => {
    const manager = new PtyManager(vi.fn(), vi.fn());
    
    manager.spawn({
      id: 'test-id',
      command: 'bash',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      env: {
        COLORTERM: 'other',
        MY_VAR: 'val',
      },
    });

    expect(pty.spawn).toHaveBeenCalledWith(
      'bash',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          COLORTERM: 'other', // override wins
          TERM_PROGRAM: 'mcode',
          MY_VAR: 'val',
        }),
      })
    );
  });
});
