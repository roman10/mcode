import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrokerClient } from '../../../src/main/pty/broker-client';
import { DEFAULT_COLS, DEFAULT_ROWS, RING_BUFFER_MAX_BYTES } from '../../../src/shared/constants';

// Suppress logger output in tests
vi.mock('../../../src/main/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We don't use IPC in these unit tests
vi.mock('../../../src/main/ipc-helpers', () => ({
  typedOn: vi.fn(),
  typedHandle: vi.fn(),
}));

/**
 * Unit tests for BrokerClient local cache behavior.
 *
 * These tests exercise the cache maps (ringBuffers, lastDataAtMap, ptyInfoMap)
 * without a real socket — we mock `_request` and invoke `_handleEvent` directly.
 */
describe('BrokerClient', () => {
  let client: BrokerClient;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleEvent(event: string, params: Record<string, unknown>): void {
    (client as any)._handleEvent(event, params);
  }

  beforeEach(() => {
    client = new BrokerClient();
  });

  describe('populateFromBroker', () => {
    it('restores ring buffer and ptyInfoMap with pid', async () => {
      const mockRequest = vi.fn().mockResolvedValue('hello world');
      (client as any)._request = mockRequest;

      await client.populateFromBroker('sess-1', { pid: 42 });

      expect(client.getReplayData('sess-1')).toBe('hello world');
      expect(client.getLastDataAt('sess-1')).toBeGreaterThan(0);

      const info = client.getInfo('sess-1');
      expect(info).toEqual({
        id: 'sess-1',
        pid: 42,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
    });

    it('restores ptyInfoMap with pid=0 when no ptyInfo provided', async () => {
      (client as any)._request = vi.fn().mockResolvedValue('data');

      await client.populateFromBroker('sess-2');

      const info = client.getInfo('sess-2');
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(0);
    });

    it('does not overwrite existing ptyInfoMap entry', async () => {
      (client as any)._request = vi.fn().mockResolvedValue('data');

      // Simulate a prior spawn that set ptyInfoMap with specific cols/rows
      (client as any).ptyInfoMap.set('sess-3', {
        id: 'sess-3',
        pid: 99,
        cols: 120,
        rows: 40,
      });

      await client.populateFromBroker('sess-3', { pid: 50 });

      const info = client.getInfo('sess-3');
      expect(info).toEqual({
        id: 'sess-3',
        pid: 99,
        cols: 120,
        rows: 40,
      });
    });

    it('restores ptyInfoMap even when broker returns no data', async () => {
      (client as any)._request = vi.fn().mockResolvedValue('');

      await client.populateFromBroker('sess-4', { pid: 10 });

      // Ring buffer should NOT be set (empty string is falsy)
      expect(client.getReplayData('sess-4')).toBe('');
      // But ptyInfoMap SHOULD be set
      const info = client.getInfo('sess-4');
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(10);
    });

    it('truncates ring buffer to RING_BUFFER_MAX_BYTES', async () => {
      const bigData = 'x'.repeat(RING_BUFFER_MAX_BYTES + 1000);
      (client as any)._request = vi.fn().mockResolvedValue(bigData);

      await client.populateFromBroker('sess-5');

      expect(client.getReplayData('sess-5').length).toBe(RING_BUFFER_MAX_BYTES);
    });
  });

  describe('pty.exit event', () => {
    it('clears all local caches for the session', async () => {
      // Populate caches first
      (client as any)._request = vi.fn().mockResolvedValue('buffer data');
      await client.populateFromBroker('sess-exit', { pid: 7 });

      expect(client.getReplayData('sess-exit')).toBe('buffer data');
      expect(client.getInfo('sess-exit')).not.toBeNull();

      // Simulate pty.exit
      handleEvent('pty.exit', { id: 'sess-exit', code: 0 });

      expect(client.getReplayData('sess-exit')).toBe('');
      expect(client.getLastDataAt('sess-exit')).toBe(0);
      expect(client.getInfo('sess-exit')).toBeNull();
    });

    it('calls registered exit callback', () => {
      const exitCb = vi.fn();
      (client as any).exitCallbacks.set('sess-cb', exitCb);

      handleEvent('pty.exit', { id: 'sess-cb', code: 1, signal: 15 });

      expect(exitCb).toHaveBeenCalledWith(1, 15);
      // Callback should be removed after firing
      expect((client as any).exitCallbacks.has('sess-cb')).toBe(false);
    });

    it('emits pty.exit event', () => {
      const listener = vi.fn();
      client.on('pty.exit', listener);

      handleEvent('pty.exit', { id: 'sess-emit', code: 0 });

      expect(listener).toHaveBeenCalledWith('sess-emit', 0, undefined);
    });
  });

  describe('pty.data event', () => {
    it('updates ring buffer and lastDataAt', () => {
      handleEvent('pty.data', { id: 'sess-data', data: 'hello' });

      expect(client.getReplayData('sess-data')).toBe('hello');
      expect(client.getLastDataAt('sess-data')).toBeGreaterThan(0);
    });

    it('appends to existing ring buffer', () => {
      handleEvent('pty.data', { id: 'sess-append', data: 'first ' });
      handleEvent('pty.data', { id: 'sess-append', data: 'second' });

      expect(client.getReplayData('sess-append')).toBe('first second');
    });

    it('truncates ring buffer at max size', () => {
      const chunk = 'a'.repeat(RING_BUFFER_MAX_BYTES);
      handleEvent('pty.data', { id: 'sess-trunc', data: chunk });
      handleEvent('pty.data', { id: 'sess-trunc', data: 'overflow' });

      const buffer = client.getReplayData('sess-trunc');
      expect(buffer.length).toBe(RING_BUFFER_MAX_BYTES);
      expect(buffer.endsWith('overflow')).toBe(true);
    });
  });

  describe('getInfo', () => {
    it('returns null for unknown sessions', () => {
      expect(client.getInfo('nonexistent')).toBeNull();
    });
  });

  describe('getReplaySince', () => {
    it('returns empty payload for unknown sessions', () => {
      const r = client.getReplaySince('nonexistent', 0);
      expect(r).toEqual({ data: '', dataStartOffset: 0, currentOffset: 0 });
    });

    it('returns full buffer when called with offset 0', () => {
      handleEvent('pty.data', { id: 'sess-rs', data: 'hello world' });
      const r = client.getReplaySince('sess-rs', 0);
      expect(r.data).toBe('hello world');
      expect(r.dataStartOffset).toBe(0);
      expect(r.currentOffset).toBe(11);
    });

    it('returns delta from offset within window', () => {
      handleEvent('pty.data', { id: 'sess-delta', data: 'abc' });
      const snap = client.getReplaySince('sess-delta', 0).currentOffset; // 3
      handleEvent('pty.data', { id: 'sess-delta', data: 'def' });
      const r = client.getReplaySince('sess-delta', snap);
      expect(r.data).toBe('def');
      expect(r.dataStartOffset).toBe(3);
      expect(r.currentOffset).toBe(6);
    });

    it('signals drop with dataStartOffset > offset when offset fell out of window', () => {
      // Fill past the cap so the earliest offset advances.
      const big = 'x'.repeat(RING_BUFFER_MAX_BYTES);
      handleEvent('pty.data', { id: 'sess-drop', data: big });
      handleEvent('pty.data', { id: 'sess-drop', data: 'tail' });
      const r = client.getReplaySince('sess-drop', 0);
      expect(r.dataStartOffset).toBeGreaterThan(0);
      expect(r.currentOffset).toBe(RING_BUFFER_MAX_BYTES + 4);
      expect(r.data.endsWith('tail')).toBe(true);
    });
  });
});
