// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleDropPaste } from '../../../../src/renderer/utils/drop-paste-scheduler';

describe('scheduleDropPaste', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('focuses the terminal synchronously and pastes nothing immediately', () => {
    const term = { focus: vi.fn(), paste: vi.fn() };
    scheduleDropPaste(['/a.png', '/b.png'], term);
    expect(term.focus).toHaveBeenCalledTimes(1);
    expect(term.paste).not.toHaveBeenCalled();
  });

  it('issues one paste per path, spaced out so Claude debounces each as its own image', () => {
    const term = { focus: vi.fn(), paste: vi.fn() };
    scheduleDropPaste(['/a.png', '/b.png', '/c.png'], term);

    vi.advanceTimersByTime(50);
    expect(term.paste).toHaveBeenCalledWith('/a.png');
    expect(term.paste).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    expect(term.paste).toHaveBeenCalledWith('/b.png');
    expect(term.paste).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(300);
    expect(term.paste).toHaveBeenCalledWith('/c.png');
    expect(term.paste).toHaveBeenCalledTimes(3);
  });

  it('does nothing for an empty path list', () => {
    const term = { focus: vi.fn(), paste: vi.fn() };
    scheduleDropPaste([], term);
    vi.advanceTimersByTime(10000);
    expect(term.focus).not.toHaveBeenCalled();
    expect(term.paste).not.toHaveBeenCalled();
  });

  it('honours overridden delays', () => {
    const term = { focus: vi.fn(), paste: vi.fn() };
    scheduleDropPaste(['/a.png', '/b.png'], term, {
      initialDelayMs: 0,
      betweenDelayMs: 1000,
    });
    vi.advanceTimersByTime(0);
    expect(term.paste).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(term.paste).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(term.paste).toHaveBeenCalledTimes(2);
  });
});
