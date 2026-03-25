import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('document', { activeElement: null });

const { createFocusRestorer } = await import(
  '../../../../src/renderer/utils/focus-utils'
);

describe('createFocusRestorer', () => {
  beforeEach(() => {
    (document as any).activeElement = null;
  });

  it('restores focus to the element that was active when created', () => {
    const mockElement = { focus: vi.fn() };
    (document as any).activeElement = mockElement;

    const restore = createFocusRestorer();
    restore();

    expect(mockElement.focus).toHaveBeenCalledOnce();
  });

  it('no-ops when no element was focused', () => {
    (document as any).activeElement = null;

    const restore = createFocusRestorer();
    expect(() => restore()).not.toThrow();
  });

  it('no-ops when activeElement has no focus method', () => {
    (document as any).activeElement = {};

    const restore = createFocusRestorer();
    expect(() => restore()).not.toThrow();
  });
});
