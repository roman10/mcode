import type {
  FileListResult,
  FileReadResult,
  FileSearchRequest,
  SearchEvent,
  SlashCommandEntry,
  SnippetEntry,
} from './types';

// ---------------------------------------------------------------------------
// Files, Search, Slash Commands, and Snippets IPC channels
// ---------------------------------------------------------------------------

export interface FilesInvokeContract {
  // --- Files ---
  'files:list':                         { params: [cwd: string]; result: FileListResult };
  'files:read':                         { params: [cwd: string, relativePath: string]; result: FileReadResult };
  'files:write':                        { params: [cwd: string, relativePath: string, content: string]; result: void };

  // --- Search ---
  'search:start':                       { params: [request: FileSearchRequest]; result: string };
  'search:cancel':                      { params: [searchId: string]; result: void };

  // --- Slash Commands ---
  'slash-commands:scan':                { params: [cwd: string]; result: SlashCommandEntry[] };

  // --- Snippets ---
  'snippets:scan':                      { params: [cwd: string]; result: SnippetEntry[] };
  'snippets:create':                    { params: [scope: 'user' | 'project', cwd: string]; result: string };
  'snippets:delete':                    { params: [filePath: string]; result: void };
  'snippets:open-folder':              { params: [scope: 'user' | 'project', cwd: string]; result: void };
}

export interface FilesPushContract {
  'search:event':                       { params: [event: SearchEvent] };
}
