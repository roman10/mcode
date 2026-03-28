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
  const entries: GeminiListedSession[] = [];

  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\.\s+(.*?)\s+\((.*?)\)\s+\[([^\]]+)\]\s*$/);
    if (!match) continue;

    const [, indexText, title, relativeAgeText, geminiSessionId] = match;
    const index = Number.parseInt(indexText, 10);
    if (!Number.isFinite(index)) continue;

    entries.push({
      index,
      title: title.trim(),
      relativeAgeText: relativeAgeText.trim() || null,
      geminiSessionId: geminiSessionId.trim(),
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
