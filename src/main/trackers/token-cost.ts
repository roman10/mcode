/**
 * Hardcoded model pricing for estimated cost calculation.
 *
 * Sources (last verified 2026-04-22):
 *   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *   Google:    https://ai.google.dev/gemini-api/docs/pricing
 *   OpenAI:    https://developers.openai.com/api/docs/pricing
 *
 * Cache multipliers are per-provider (see CLAUDE_CACHE / OPENAI_CACHE / GEMINI_CACHE).
 * Copilot rows inherit multipliers from whichever provider-model they normalize to,
 * since Copilot sessions delegate to Claude, Gemini, or OpenAI under the hood.
 */

interface CacheMultipliers {
  cacheWrite5mMult: number; // multiplier on input price
  cacheWrite1hMult: number;
  cacheReadMult: number;
}

interface ModelPricing extends CacheMultipliers {
  input: number;  // $ per MTok
  output: number; // $ per MTok
  fastMult?: number; // fast-mode price multiplier; defaults to FAST_MODE_MULTIPLIER
}

// Claude: 5m write 1.25x, 1h write 2x, cache read 0.1x (per Anthropic docs).
const CLAUDE_CACHE: CacheMultipliers = { cacheWrite5mMult: 1.25, cacheWrite1hMult: 2.0, cacheReadMult: 0.1 };
// OpenAI: cached input is 10% of input; no separate per-token write charge.
const OPENAI_CACHE: CacheMultipliers = { cacheWrite5mMult: 0, cacheWrite1hMult: 0, cacheReadMult: 0.1 };
// Gemini: cached input ≈ 25% of input on 2.5 Pro/Flash; no per-token write charge.
const GEMINI_CACHE: CacheMultipliers = { cacheWrite5mMult: 0, cacheWrite1hMult: 0, cacheReadMult: 0.25 };

// Keyed by normalized model version (e.g. "opus-4.6")
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.8 fast mode is 2x base ($10/$50), cheaper than the legacy 6x fast tier.
  'opus-4.8':   { input: 5,    output: 25,   fastMult: 2, ...CLAUDE_CACHE },
  'opus-4.7':   { input: 5,    output: 25,   ...CLAUDE_CACHE },
  'opus-4.6':   { input: 5,    output: 25,   ...CLAUDE_CACHE },
  'opus-4.5':   { input: 5,    output: 25,   ...CLAUDE_CACHE },
  'opus-4.1':   { input: 15,   output: 75,   ...CLAUDE_CACHE },
  'opus-4':     { input: 15,   output: 75,   ...CLAUDE_CACHE },
  'sonnet-4.6': { input: 3,    output: 15,   ...CLAUDE_CACHE },
  'sonnet-4.5': { input: 3,    output: 15,   ...CLAUDE_CACHE },
  'sonnet-4':   { input: 3,    output: 15,   ...CLAUDE_CACHE },
  'sonnet-3.7': { input: 3,    output: 15,   ...CLAUDE_CACHE },
  'haiku-4.5':  { input: 1,    output: 5,    ...CLAUDE_CACHE },
  'haiku-3.5':  { input: 0.80, output: 4,    ...CLAUDE_CACHE },
  'haiku-3':    { input: 0.25, output: 1.25, ...CLAUDE_CACHE },
};

/**
 * Gemini model pricing (Developer API, ≤200k context tier).
 * Keyed by normalized Gemini model name (output of normalizeGeminiModel).
 * Thinking tokens are billed at the output rate.
 * Models with tiered pricing (≤200k / >200k) use the lower tier.
 */
const GEMINI_PRICING: Record<string, ModelPricing> = {
  'gemini-3.1-pro':        { input: 2.00,  output: 12.00, ...GEMINI_CACHE },
  'gemini-3.1-flash-lite': { input: 0.25,  output: 1.50,  ...GEMINI_CACHE },
  'gemini-3-flash':        { input: 0.50,  output: 3.00,  ...GEMINI_CACHE },
  'gemini-2.5-pro':        { input: 1.25,  output: 10.00, ...GEMINI_CACHE },
  'gemini-2.5-flash':      { input: 0.30,  output: 2.50,  ...GEMINI_CACHE },
  'gemini-2.5-flash-lite': { input: 0.10,  output: 0.40,  ...GEMINI_CACHE },
  'gemini-2.0-flash':      { input: 0.10,  output: 0.40,  ...GEMINI_CACHE }, // deprecated, shutdown June 2026
};

/**
 * OpenAI model pricing. Codex models use the same underlying API pricing.
 */
const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-5.4':            { input: 2.50,  output: 15.00, ...OPENAI_CACHE },
  'gpt-5.4-mini':       { input: 0.75,  output: 4.50,  ...OPENAI_CACHE },
  'gpt-5.4-nano':       { input: 0.20,  output: 1.25,  ...OPENAI_CACHE },
  'gpt-5.3-codex':      { input: 1.75,  output: 14.00, ...OPENAI_CACHE },
  'gpt-5.2':            { input: 1.75,  output: 14.00, ...OPENAI_CACHE },
  'gpt-5.1':            { input: 1.25,  output: 10.00, ...OPENAI_CACHE },
  'gpt-5.1-codex':      { input: 1.25,  output: 10.00, ...OPENAI_CACHE },
  'gpt-5.1-codex-mini': { input: 0.25,  output: 2.00,  ...OPENAI_CACHE },
  'gpt-5':              { input: 1.25,  output: 10.00, ...OPENAI_CACHE },
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

/**
 * Normalize a Copilot model name for display.
 * Copilot sessions can use models from multiple providers:
 * "claude-sonnet-4.5" → "sonnet-4.5"   (delegates to normalizeModelVersion)
 * "models/gemini-2.5-pro" → "gemini-2.5-pro"  (delegates to normalizeGeminiModel)
 * "gpt-5.4" → "gpt-5.4"               (passthrough)
 */
export function normalizeCopilotModel(model: string): string {
  if (model.startsWith('claude-')) return normalizeModelVersion(model);
  if (model.startsWith('models/') || model.startsWith('gemini')) return normalizeGeminiModel(model);
  return model;
}

/** Normalize to family name: "opus", "sonnet", "haiku", "gpt", or "unknown". */
export function normalizeModelFamily(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('gpt')) return 'gpt';
  return 'unknown';
}

const warnedUnknownModels = new Set<string>();

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
  let pricing = MODEL_PRICING[version];
  if (!pricing) {
    // Try Gemini pricing with Gemini-specific normalization
    pricing = GEMINI_PRICING[normalizeGeminiModel(model)];
  }
  if (!pricing) {
    // Try OpenAI pricing (Codex models use clean names, no normalization needed)
    pricing = OPENAI_PRICING[model];
  }
  if (!pricing) {
    if (!warnedUnknownModels.has(model)) {
      warnedUnknownModels.add(model);
      console.warn(`[token-cost] No pricing for model "${model}"; cost reported as $0`);
    }
    return 0;
  }

  const multiplier = isFastMode ? (pricing.fastMult ?? FAST_MODE_MULTIPLIER) : 1;
  const cost =
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheWrite5m * pricing.input * pricing.cacheWrite5mMult +
      cacheWrite1h * pricing.input * pricing.cacheWrite1hMult +
      cacheRead * pricing.input * pricing.cacheReadMult) *
    multiplier / 1_000_000;

  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal places
}
