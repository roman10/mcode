import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Construct the path to a Claude Code JSONL transcript file.
 * Claude Code stores transcripts at: ~/.claude/projects/<encoded-cwd>/<claudeSessionId>.jsonl
 * where <encoded-cwd> is the cwd with '/' replaced by '-'.
 */
export function getTranscriptPath(cwd: string, claudeSessionId: string): string {
  const encoded = cwd.replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', encoded, `${claudeSessionId}.jsonl`);
}
