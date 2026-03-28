/**
 * Hardcoded Anthropic model pricing for estimated cost calculation.
 * Source: https://platform.claude.com/docs/en/docs/about-claude/pricing
 * Last verified: 2026-03-19
 *
 * Cache multipliers (applied to base input price):
 *   5-minute write = 1.25x
 *   1-hour write   = 2.0x
 *   Cache read      = 0.1x
 */

interface ModelPricing {
  input: number;  // $ per MTok
  output: number; // $ per MTok
}

// Keyed by normalized model version (e.g. "opus-4.6")
const MODEL_PRICING: Record<string, ModelPricing> = {
  'opus-4.6':   { input: 5,    output: 25 },
  'opus-4.5':   { input: 5,    output: 25 },
  'opus-4.1':   { input: 15,   output: 75 },
  'opus-4':     { input: 15,   output: 75 },
  'sonnet-4.6': { input: 3,    output: 15 },
  'sonnet-4.5': { input: 3,    output: 15 },
  'sonnet-4':   { input: 3,    output: 15 },
  'sonnet-3.7': { input: 3,    output: 15 },
  'haiku-4.5':  { input: 1,    output: 5 },
  'haiku-3.5':  { input: 0.80, output: 4 },
  'haiku-3':    { input: 0.25, output: 1.25 },
};

const FAST_MODE_MULTIPLIER = 6;

/**
 * Normalize full model name to version key for pricing lookup.
 * "claude-opus-4-6" → "opus-4.6"
 * "claude-sonnet-4-5-20251022" → "sonnet-4.5"
 * "claude-haiku-4-5" → "haiku-4.5"
 */
export function normalizeModelVersion(model: string): string {
  // Strip "claude-" prefix
  let name = model.replace(/^claude-/, '');
  // Strip date suffix like "-20251022"
  name = name.replace(/-\d{8}$/, '');
  // Known families and their position in the name
  const families = ['opus', 'sonnet', 'haiku'];
  for (const family of families) {
    if (name.startsWith(family)) {
      const versionPart = name.slice(family.length + 1); // skip "family-"
      // Convert "4-6" → "4.6", "4-5" → "4.5", "4" → "4"
      const version = versionPart.replace(/-/, '.');
      return version ? `${family}-${version}` : family;
    }
  }
  return name; // Unknown model, return as-is
}

/**
 * Normalize a Gemini model name for display.
 * "models/gemini-2.5-pro-preview-05-06" → "gemini-2.5-pro"
 * "gemini-2.5-flash-lite-preview-04-17" → "gemini-2.5-flash-lite"
 */
export function normalizeGeminiModel(model: string): string {
  let name = model.replace(/^models\//, '');
  name = name.replace(/-(preview|exp|latest)(-\d{2,4}(-\d{2})?)?$/, '');
  name = name.replace(/-\d{8}$/, '');
  return name;
}

/** Normalize to family name: "opus", "sonnet", "haiku", or "unknown". */
export function normalizeModelFamily(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'unknown';
}

/** Estimate cost in USD for a set of token counts. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  isFastMode: boolean,
): number {
  const version = normalizeModelVersion(model);
  const pricing = MODEL_PRICING[version];
  if (!pricing) return 0;

  const multiplier = isFastMode ? FAST_MODE_MULTIPLIER : 1;
  const cost =
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheWrite5m * pricing.input * 1.25 +
      cacheWrite1h * pricing.input * 2.0 +
      cacheRead * pricing.input * 0.1) *
    multiplier / 1_000_000;

  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal places
}
