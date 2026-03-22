import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import type { FileSearchMatch, SearchEvent } from '../../shared/types';

export function registerSearchTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('file_search', {
    description:
      'Search for text in files across session working directories using ripgrep. ' +
      'Supports regex and case-sensitive options. Returns matching lines with file paths and line numbers.',
    inputSchema: {
      query: z.string().describe('Search query (text or regex)'),
      isRegex: z.boolean().optional().default(false).describe('Whether query is a regex pattern'),
      caseSensitive: z.boolean().optional().default(false).describe('Whether search is case-sensitive'),
      maxResults: z.number().optional().default(50).describe('Maximum number of matches to return'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, isRegex, caseSensitive, maxResults }) => {
    // Collect cwds from all sessions
    const sessions = ctx.sessionManager.list();
    const cwds = [...new Set(sessions.map((s) => s.cwd))];

    if (cwds.length === 0) {
      return { content: [{ type: 'text', text: 'No sessions open — no directories to search.' }] };
    }

    const allMatches: Array<{ repoPath: string; repoName: string; match: FileSearchMatch }> = [];
    let truncated = false;
    let totalMatches = 0;
    let totalFiles = 0;
    let durationMs = 0;
    let searchError: string | null = null;

    const searchId = `mcp-${Date.now()}`;

    // Subscribe to events for this search (doesn't interfere with renderer listener)
    const resultPromise = new Promise<void>((resolve) => {
      const dispose = ctx.fileSearch.addListener((event: SearchEvent) => {
        if (event.searchId !== searchId) return;

        if (event.type === 'progress') {
          for (const match of event.matches) {
            allMatches.push({ repoPath: event.repoPath, repoName: event.repoName, match });
          }
        } else if (event.type === 'complete') {
          totalMatches = event.totalMatches;
          totalFiles = event.totalFiles;
          truncated = event.truncated;
          durationMs = event.durationMs;
          dispose();
          resolve();
        } else if (event.type === 'error') {
          searchError = event.message;
          dispose();
          resolve();
        }
      });
    });

    await ctx.fileSearch.search({
      id: searchId,
      query,
      isRegex,
      caseSensitive,
      cwds,
      maxResults,
    });

    await resultPromise;

    if (searchError) {
      return { content: [{ type: 'text', text: `Search error: ${searchError}` }] };
    }

    const summary = {
      totalMatches,
      totalFiles,
      truncated,
      durationMs,
      repos: cwds.length,
    };

    const matchLines = allMatches.slice(0, maxResults).map((m) =>
      `${m.repoName}/${m.match.path}:${m.match.line}: ${m.match.lineContent}`,
    );

    return {
      content: [
        { type: 'text', text: JSON.stringify(summary, null, 2) },
        { type: 'text', text: matchLines.join('\n') || 'No matches found.' },
      ],
    };
  });
}
