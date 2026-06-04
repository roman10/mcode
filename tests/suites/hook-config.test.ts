import { describe, expect, it } from 'vitest';
import {
  mergeMcodeHooks,
  removeMcodeHooksForPort,
  extractMcodeHookPortPids,
} from '../../src/main/hooks/hook-config';

describe('hook config helpers', () => {
  it('merges mcode hooks using Claude hook groups', () => {
    const settings = mergeMcodeHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: 'existing',
            hooks: [{ type: 'http', url: 'http://localhost:9999/other' }],
          },
        ],
      },
      allowedHttpHookUrls: ['https://example.com'],
    }, 7777);

    expect(settings.allowedHttpHookUrls).toContain('http://localhost:*');
    const preToolUse = settings.hooks?.PreToolUse;
    expect(preToolUse).toHaveLength(2);
    expect(preToolUse?.[0]).toMatchObject({ matcher: 'existing' });
    expect(preToolUse?.[1]).toMatchObject({
      hooks: [
        {
          type: 'http',
          url: 'http://localhost:7777/hook',
          headers: expect.objectContaining({
            'X-Mcode-Hook': '1',
            'X-Mcode-Session-Id': '$MCODE_SESSION_ID',
          }),
          allowedEnvVars: ['MCODE_SESSION_ID'],
        },
      ],
    });
  });

  it('removes matching-port mcode-owned hooks and preserves user hooks', () => {
    const cleaned = removeMcodeHooksForPort({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'http',
                url: 'http://localhost:7777/hook',
                headers: {
                  'X-Mcode-Hook': '1',
                  'X-Mcode-Session-Id': '$MCODE_SESSION_ID',
                },
              },
              {
                type: 'http',
                url: 'http://localhost:8888/user-hook',
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: 'http',
                url: 'http://localhost:7777/hook',
                headers: {
                  'X-Mcode-Hook': '1',
                },
              },
            ],
          },
        ],
      },
    }, 7777);

    expect(cleaned.hooks?.PreToolUse).toEqual([
      {
        hooks: [
          {
            type: 'http',
            url: 'http://localhost:8888/user-hook',
          },
        ],
      },
    ]);
    expect(cleaned.hooks?.Stop).toBeUndefined();
  });

  it('includes PID header in hook entries', () => {
    const settings = mergeMcodeHooks({}, 7777);
    const preToolUse = settings.hooks?.PreToolUse;
    expect(preToolUse).toHaveLength(1);
    const group = preToolUse?.[0] as { hooks: Array<{ headers: Record<string, string> }> };
    expect(group.hooks[0].headers['X-Mcode-PID']).toBe(String(process.pid));
  });

  it('mergeMcodeHooks preserves other instances\' hooks', () => {
    // Instance A on port 7777
    let settings = mergeMcodeHooks({}, 7777);
    // Instance B on port 7778
    settings = mergeMcodeHooks(settings, 7778);

    const preToolUse = settings.hooks?.PreToolUse;
    // Should have hooks for both ports
    expect(preToolUse).toHaveLength(2);
    const urls = (preToolUse as Array<{ hooks: Array<{ url: string }> }>)
      .map((g) => g.hooks[0].url);
    expect(urls).toContain('http://localhost:7777/hook');
    expect(urls).toContain('http://localhost:7778/hook');
  });

  it('mergeMcodeHooks replaces its own port on re-merge', () => {
    let settings = mergeMcodeHooks({}, 7777);
    settings = mergeMcodeHooks(settings, 7777);

    const preToolUse = settings.hooks?.PreToolUse;
    // Should have only one entry for port 7777 (not duplicated)
    expect(preToolUse).toHaveLength(1);
  });

  it('removeMcodeHooksForPort only removes hooks for specified port', () => {
    let settings = mergeMcodeHooks({}, 7777);
    settings = mergeMcodeHooks(settings, 7778);

    const cleaned = removeMcodeHooksForPort(settings, 7777);
    const preToolUse = cleaned.hooks?.PreToolUse;
    expect(preToolUse).toHaveLength(1);
    const group = preToolUse?.[0] as { hooks: Array<{ url: string }> };
    expect(group.hooks[0].url).toBe('http://localhost:7778/hook');
  });

  it('removeMcodeHooksForPort preserves user hooks', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'http',
                url: 'http://localhost:7777/hook',
                headers: { 'X-Mcode-Hook': '1', 'X-Mcode-PID': '12345' },
              },
              {
                type: 'http',
                url: 'http://localhost:8888/user-hook',
              },
            ],
          },
        ] as Array<{ hooks: Array<{ type: string; url: string; headers?: Record<string, string> }> }>,
      },
    };

    const cleaned = removeMcodeHooksForPort(settings, 7777);
    expect(cleaned.hooks?.PreToolUse).toEqual([
      {
        hooks: [
          {
            type: 'http',
            url: 'http://localhost:8888/user-hook',
          },
        ],
      },
    ]);
  });

  it('extractMcodeHookPortPids finds port+PID pairs from settings', () => {
    let settings = mergeMcodeHooks({}, 7777);
    settings = mergeMcodeHooks(settings, 7778);

    const portPids = extractMcodeHookPortPids(settings);
    expect(portPids.size).toBe(2);
    expect(portPids.has(7777)).toBe(true);
    expect(portPids.has(7778)).toBe(true);
    // Both should map to current process PID (since mergeMcodeHooks uses process.pid)
    expect(portPids.get(7777)).toBe(process.pid);
    expect(portPids.get(7778)).toBe(process.pid);
  });

  it('extractMcodeHookPortPids returns empty map for no hooks', () => {
    const portPids = extractMcodeHookPortPids({});
    expect(portPids.size).toBe(0);
  });
});
