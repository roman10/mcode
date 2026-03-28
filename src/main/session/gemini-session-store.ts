import { logger } from '../logger';

export interface GeminiListedSession {
  index: number;
  title: string;
  relativeAgeText: string | null;
  geminiSessionId: string;
}

export interface GeminiSessionMatchInput {
  initialPrompt?: string;
  claimedSessionIds: Set<string>;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function parseGeminiSessionList(output: string): GeminiListedSession[] {
  const lines = output.split('\n');
  const entries: GeminiListedSession[] = [];
  let nonEmptyLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    nonEmptyLines++;

    const match = line.match(/^\s*(\d+)\.\s+(.*?)\s+\((.*?)\)\s+\[([^\]]+)\]\s*$/);
    if (!match) continue;

    const [, indexText, title, relativeAgeText, geminiSessionId] = match;
    const index = Number.parseInt(indexText, 10);
    if (!Number.isFinite(index) || index < 1) continue;

    entries.push({
      index,
      title: title.trim(),
      relativeAgeText: relativeAgeText.trim() || null,
      geminiSessionId: geminiSessionId.trim(),
    });
  }

  // Warn if we saw non-empty lines but parsed nothing — likely a format change
  if (nonEmptyLines > 0 && entries.length === 0) {
    logger.warn('gemini-session-store', 'Gemini --list-sessions output had content but no parseable sessions', {
      nonEmptyLines,
      firstLine: lines.find((l) => l.trim())?.slice(0, 120),
    });
  }

  return entries;
}

export function selectGeminiSessionCandidate(
  entries: GeminiListedSession[],
  input: GeminiSessionMatchInput,
): GeminiListedSession | null {
  const available = entries.filter((entry) => !input.claimedSessionIds.has(entry.geminiSessionId));
  if (available.length === 0) return null;

  const promptTitle = input.initialPrompt?.split('\n')[0]?.trim();
  if (promptTitle) {
    const normalizedPrompt = normalizeText(promptTitle);
    const exactMatch = available.find((entry) => normalizeText(entry.title) === normalizedPrompt);
    if (exactMatch) return exactMatch;

    const fuzzyMatch = available.find((entry) => {
      const normalizedTitle = normalizeText(entry.title);
      return normalizedTitle.includes(normalizedPrompt) || normalizedPrompt.includes(normalizedTitle);
    });
    if (fuzzyMatch) return fuzzyMatch;
  }

  return available[available.length - 1] ?? null;
}

export function resolveGeminiResumeIndex(
  entries: GeminiListedSession[],
  geminiSessionId: string,
): number | null {
  return entries.find((entry) => entry.geminiSessionId === geminiSessionId)?.index ?? null;
}
