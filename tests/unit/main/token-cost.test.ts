import { describe, it, expect, vi } from 'vitest';
import { normalizeModelVersion, normalizeModelFamily, normalizeGeminiModel, normalizeCopilotModel, estimateCostUsd } from '../../../src/main/trackers/token-cost';

describe('normalizeModelVersion', () => {
  it('strips claude- prefix and date suffix', () => {
    expect(normalizeModelVersion('claude-opus-4-8')).toBe('opus-4.8');
    expect(normalizeModelVersion('claude-opus-4-8-20260529')).toBe('opus-4.8');
    expect(normalizeModelVersion('claude-opus-4-7')).toBe('opus-4.7');
    expect(normalizeModelVersion('claude-opus-4-6')).toBe('opus-4.6');
    expect(normalizeModelVersion('claude-sonnet-4-5-20251022')).toBe('sonnet-4.5');
    expect(normalizeModelVersion('claude-haiku-4-5')).toBe('haiku-4.5');
  });

  it('handles single-segment versions', () => {
    expect(normalizeModelVersion('claude-opus-4')).toBe('opus-4');
    expect(normalizeModelVersion('claude-sonnet-4')).toBe('sonnet-4');
  });

  it('handles bare family names', () => {
    expect(normalizeModelVersion('claude-opus')).toBe('opus');
    expect(normalizeModelVersion('claude-sonnet')).toBe('sonnet');
  });

  it('returns unknown models as-is after stripping prefix', () => {
    expect(normalizeModelVersion('claude-unknown-model')).toBe('unknown-model');
    expect(normalizeModelVersion('gpt-4')).toBe('gpt-4');
  });

  it('handles sonnet 3.7', () => {
    expect(normalizeModelVersion('claude-sonnet-3-7')).toBe('sonnet-3.7');
  });

  it('handles bare family names correctly', () => {
    expect(normalizeModelVersion('claude-opus')).toBe('opus');
    expect(normalizeModelVersion('claude-sonnet')).toBe('sonnet');
    expect(normalizeModelVersion('claude-haiku')).toBe('haiku');
  });
});

describe('normalizeModelFamily', () => {
  it('detects opus', () => {
    expect(normalizeModelFamily('claude-opus-4-6')).toBe('opus');
    expect(normalizeModelFamily('Claude-Opus-4')).toBe('opus');
  });

  it('detects sonnet', () => {
    expect(normalizeModelFamily('claude-sonnet-4-5-20251022')).toBe('sonnet');
    expect(normalizeModelFamily('claude-3-7-sonnet')).toBe('sonnet');
  });

  it('detects haiku', () => {
    expect(normalizeModelFamily('claude-haiku-3-5')).toBe('haiku');
  });

  it('detects gpt', () => {
    expect(normalizeModelFamily('gpt-4')).toBe('gpt');
    expect(normalizeModelFamily('gpt-5.4')).toBe('gpt');
    expect(normalizeModelFamily('o1-preview')).toBe('unknown'); // currently mapped to unknown unless we add it
  });

  it('detects gemini', () => {
    expect(normalizeModelFamily('gemini-3-flash')).toBe('gemini');
    expect(normalizeModelFamily('gemini-2.5-pro')).toBe('gemini');
    expect(normalizeModelFamily('models/gemini-2.5-flash-preview')).toBe('gemini');
  });

  it('returns unknown for unrecognized models', () => {
    expect(normalizeModelFamily('')).toBe('unknown');
    expect(normalizeModelFamily('llama-3')).toBe('unknown');
  });
});

describe('normalizeGeminiModel', () => {
  it('strips models/ prefix and preview suffix', () => {
    expect(normalizeGeminiModel('models/gemini-2.5-pro-preview-05-06')).toBe('gemini-2.5-pro');
  });

  it('strips models/ prefix only when no qualifier', () => {
    expect(normalizeGeminiModel('models/gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });

  it('handles flash-lite with preview', () => {
    expect(normalizeGeminiModel('gemini-2.5-flash-lite-preview-04-17')).toBe('gemini-2.5-flash-lite');
  });

  it('strips date suffix', () => {
    expect(normalizeGeminiModel('gemini-2.0-flash-20250417')).toBe('gemini-2.0-flash');
  });

  it('strips -exp suffix', () => {
    expect(normalizeGeminiModel('gemini-2.0-flash-exp-0206')).toBe('gemini-2.0-flash');
  });

  it('strips -latest suffix', () => {
    expect(normalizeGeminiModel('gemini-2.5-pro-latest')).toBe('gemini-2.5-pro');
  });

  it('handles already clean names', () => {
    expect(normalizeGeminiModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(normalizeGeminiModel('gemini-3-flash')).toBe('gemini-3-flash');
  });
});

describe('normalizeCopilotModel', () => {
  it('delegates Claude models to normalizeModelVersion', () => {
    expect(normalizeCopilotModel('claude-sonnet-4.5')).toBe('sonnet-4.5');
    expect(normalizeCopilotModel('claude-opus-4-6')).toBe('opus-4.6');
    expect(normalizeCopilotModel('claude-haiku-4-5')).toBe('haiku-4.5');
  });

  it('delegates Gemini models to normalizeGeminiModel', () => {
    expect(normalizeCopilotModel('models/gemini-2.5-pro-preview-05-06')).toBe('gemini-2.5-pro');
    expect(normalizeCopilotModel('gemini-2.5-flash-lite-preview-04-17')).toBe('gemini-2.5-flash-lite');
  });

  it('passes through GPT models as-is', () => {
    expect(normalizeCopilotModel('gpt-5.4')).toBe('gpt-5.4');
    expect(normalizeCopilotModel('gpt-5.1-codex-mini')).toBe('gpt-5.1-codex-mini');
  });

  it('passes through unknown models as-is', () => {
    expect(normalizeCopilotModel('unknown-model')).toBe('unknown-model');
    expect(normalizeCopilotModel('llama-3')).toBe('llama-3');
  });
});

describe('estimateCostUsd', () => {
  it('calculates basic input/output cost', () => {
    // opus-4.6: input $5/MTok, output $25/MTok
    const cost = estimateCostUsd('claude-opus-4-6', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(30); // $5 + $25
  });

  it('calculates cost for opus-4.8', () => {
    // opus-4.8: input $5/MTok, output $25/MTok
    const cost = estimateCostUsd('claude-opus-4-8', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(30); // $5 + $25
  });

  it('applies 2x fast mode multiplier for opus-4.8 (not the legacy 6x)', () => {
    const normal = estimateCostUsd('claude-opus-4-8', 1_000_000, 0, 0, 0, 0, false);
    const fast = estimateCostUsd('claude-opus-4-8', 1_000_000, 0, 0, 0, 0, true);
    expect(normal).toBe(5);
    expect(fast).toBe(10); // 2x, not 30
  });

  it('calculates cost for sonnet-3.7', () => {
    // sonnet-3.7: input $3/MTok, output $15/MTok
    const cost = estimateCostUsd('claude-sonnet-3-7', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(18); // $3 + $15
  });

  it('applies fast mode multiplier', () => {
    const normal = estimateCostUsd('claude-opus-4-6', 1_000_000, 0, 0, 0, 0, false);
    const fast = estimateCostUsd('claude-opus-4-6', 1_000_000, 0, 0, 0, 0, true);
    expect(fast).toBe(normal * 6);
  });

  it('accounts for cache write 5m (1.25x input price)', () => {
    // sonnet-4.5: input $3/MTok
    const cost = estimateCostUsd('claude-sonnet-4-5', 0, 0, 1_000_000, 0, 0, false);
    expect(cost).toBe(3 * 1.25); // $3.75
  });

  it('accounts for cache write 1h (2x input price)', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5', 0, 0, 0, 1_000_000, 0, false);
    expect(cost).toBe(3 * 2); // $6
  });

  it('accounts for cache read (0.1x input price)', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5', 0, 0, 0, 0, 1_000_000, false);
    expect(cost).toBe(0.3);
  });

  it('calculates Gemini cost via Gemini pricing table', () => {
    // gemini-3-flash: input $0.50/MTok, output $3.00/MTok
    const cost = estimateCostUsd('gemini-3-flash', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(3.5); // $0.50 + $3.00
  });

  it('calculates Gemini cost with preview suffix', () => {
    // gemini-3-flash-preview normalizes to gemini-3-flash
    const cost = estimateCostUsd('gemini-3-flash-preview', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(3.5);
  });

  it('calculates Gemini pro cost', () => {
    // gemini-2.5-pro: input $1.25/MTok, output $10.00/MTok
    const cost = estimateCostUsd('gemini-2.5-pro', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(11.25);
  });

  it('calculates OpenAI gpt-5.4 cost', () => {
    // gpt-5.4: input $2.50/MTok, output $15.00/MTok
    const cost = estimateCostUsd('gpt-5.4', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(17.5); // $2.50 + $15.00
  });

  it('calculates OpenAI gpt-5.1-codex-mini cost', () => {
    // gpt-5.1-codex-mini: input $0.25/MTok, output $2.00/MTok
    const cost = estimateCostUsd('gpt-5.1-codex-mini', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(2.25); // $0.25 + $2.00
  });

  it('calculates OpenAI cache read cost (0.1x input)', () => {
    // gpt-5.4: input $2.50/MTok → cache read = $0.25/MTok
    const cost = estimateCostUsd('gpt-5.4', 0, 0, 0, 0, 1_000_000, false);
    expect(cost).toBe(0.25);
  });

  it('does not bill OpenAI cache writes (no per-token write charge)', () => {
    // Copilot rows normalized to gpt-* populate cacheWrite1hTokens, but OpenAI
    // doesn't charge per-token for writes. Both write buckets should cost $0.
    expect(estimateCostUsd('gpt-5.4', 0, 0, 1_000_000, 0, 0, false)).toBe(0);
    expect(estimateCostUsd('gpt-5.4', 0, 0, 0, 1_000_000, 0, false)).toBe(0);
  });

  it('calculates Gemini cache read at 0.25x input', () => {
    // gemini-2.5-pro: input $1.25/MTok → cache read = $0.3125/MTok (0.25x)
    const cost = estimateCostUsd('gemini-2.5-pro', 0, 0, 0, 0, 1_000_000, false);
    expect(cost).toBe(0.3125);
  });

  it('does not bill Gemini cache writes', () => {
    expect(estimateCostUsd('gemini-2.5-pro', 0, 0, 1_000_000, 0, 0, false)).toBe(0);
    expect(estimateCostUsd('gemini-2.5-pro', 0, 0, 0, 1_000_000, 0, false)).toBe(0);
  });

  it('returns 0 for unknown models and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Use a unique model name so the module-level dedup Set doesn't swallow the warning
      // from prior tests in this run.
      const unknown = `unknown-model-${Math.random().toString(36).slice(2)}`;
      expect(estimateCostUsd(unknown, 1_000_000, 1_000_000, 0, 0, 0, false)).toBe(0);
      expect(estimateCostUsd(unknown, 1_000_000, 1_000_000, 0, 0, 0, false)).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(unknown);
    } finally {
      warn.mockRestore();
    }
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCostUsd('claude-opus-4-6', 0, 0, 0, 0, 0, false)).toBe(0);
  });

  it('rounds to 6 decimal places', () => {
    // Small token counts should produce a cleanly rounded result
    const cost = estimateCostUsd('claude-haiku-3', 100, 0, 0, 0, 0, false);
    // 100 * 0.25 / 1_000_000 = 0.000025
    expect(cost).toBe(0.000025);
    const parts = cost.toString().split('.');
    expect((parts[1] || '').length).toBeLessThanOrEqual(6);
  });
});
