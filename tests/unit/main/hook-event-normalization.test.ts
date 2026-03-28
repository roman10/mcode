import { describe, expect, it } from 'vitest';
import { normalizeHookEventName } from '../../../src/main/hooks/hook-server';

describe('normalizeHookEventName', () => {
  it('maps Gemini BeforeTool to PreToolUse', () => {
    expect(normalizeHookEventName('BeforeTool')).toBe('PreToolUse');
  });

  it('maps Gemini AfterTool to PostToolUse', () => {
    expect(normalizeHookEventName('AfterTool')).toBe('PostToolUse');
  });

  it('maps Gemini AfterAgent to Stop', () => {
    expect(normalizeHookEventName('AfterAgent')).toBe('Stop');
  });

  it('maps Gemini BeforeAgent to UserPromptSubmit', () => {
    expect(normalizeHookEventName('BeforeAgent')).toBe('UserPromptSubmit');
  });

  it('passes through standard mcode event names unchanged', () => {
    expect(normalizeHookEventName('SessionStart')).toBe('SessionStart');
    expect(normalizeHookEventName('SessionEnd')).toBe('SessionEnd');
    expect(normalizeHookEventName('PreToolUse')).toBe('PreToolUse');
    expect(normalizeHookEventName('Stop')).toBe('Stop');
    expect(normalizeHookEventName('Notification')).toBe('Notification');
  });

  it('passes through unknown event names unchanged', () => {
    expect(normalizeHookEventName('BeforeModel')).toBe('BeforeModel');
    expect(normalizeHookEventName('SomeNewEvent')).toBe('SomeNewEvent');
  });
});
