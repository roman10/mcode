import { describe, it, expect } from 'vitest';
import { normalizeHookEventName, parseCopilotToolArgs } from '../../../src/main/hooks/hook-server';

describe('normalizeHookEventName', () => {
  // Gemini mappings
  it('maps Gemini BeforeTool → PreToolUse', () => {
    expect(normalizeHookEventName('BeforeTool')).toBe('PreToolUse');
  });

  it('maps Gemini AfterTool → PostToolUse', () => {
    expect(normalizeHookEventName('AfterTool')).toBe('PostToolUse');
  });

  it('maps Gemini AfterAgent → Stop', () => {
    expect(normalizeHookEventName('AfterAgent')).toBe('Stop');
  });

  it('maps Gemini BeforeAgent → UserPromptSubmit', () => {
    expect(normalizeHookEventName('BeforeAgent')).toBe('UserPromptSubmit');
  });

  // Copilot mappings
  it('maps Copilot sessionStart → SessionStart', () => {
    expect(normalizeHookEventName('sessionStart')).toBe('SessionStart');
  });

  it('maps Copilot sessionEnd → SessionEnd', () => {
    expect(normalizeHookEventName('sessionEnd')).toBe('SessionEnd');
  });

  it('maps Copilot preToolUse → PreToolUse', () => {
    expect(normalizeHookEventName('preToolUse')).toBe('PreToolUse');
  });

  it('maps Copilot postToolUse → PostToolUse', () => {
    expect(normalizeHookEventName('postToolUse')).toBe('PostToolUse');
  });

  it('maps Copilot userPromptSubmitted → UserPromptSubmit', () => {
    expect(normalizeHookEventName('userPromptSubmitted')).toBe('UserPromptSubmit');
  });

  it('maps Copilot errorOccurred → Notification', () => {
    expect(normalizeHookEventName('errorOccurred')).toBe('Notification');
  });

  // Pass-through for canonical names
  it('passes through canonical names unchanged', () => {
    expect(normalizeHookEventName('SessionStart')).toBe('SessionStart');
    expect(normalizeHookEventName('PreToolUse')).toBe('PreToolUse');
    expect(normalizeHookEventName('Stop')).toBe('Stop');
  });

  it('passes through unknown names unchanged', () => {
    expect(normalizeHookEventName('UnknownEvent')).toBe('UnknownEvent');
  });
});

describe('parseCopilotToolArgs', () => {
  it('parses a valid JSON string', () => {
    const result = parseCopilotToolArgs('{"command":"ls -la","description":"List files"}');
    expect(result).toEqual({ command: 'ls -la', description: 'List files' });
  });

  it('returns object as-is when already parsed', () => {
    const obj = { command: 'git status', description: 'Check status' };
    expect(parseCopilotToolArgs(obj)).toBe(obj);
  });

  it('returns null for invalid JSON string', () => {
    expect(parseCopilotToolArgs('not json')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseCopilotToolArgs(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseCopilotToolArgs(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCopilotToolArgs('')).toBeNull();
  });

  it('returns null for number', () => {
    expect(parseCopilotToolArgs(42)).toBeNull();
  });
});
