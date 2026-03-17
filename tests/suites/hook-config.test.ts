import { describe, expect, it } from 'vitest';
import { mergeMcodeHooks, removeMcodeHooks } from '../../src/main/hook-config';

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
          headers: {
            'X-Mcode-Hook': '1',
            'X-Mcode-Session-Id': '$MCODE_SESSION_ID',
          },
          allowedEnvVars: ['MCODE_SESSION_ID'],
        },
      ],
    });
  });

  it('removes only mcode-owned hooks and preserves user hooks', () => {
    const cleaned = removeMcodeHooks({
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
    });

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
});