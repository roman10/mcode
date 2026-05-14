// --- Slash Commands ---

export interface SlashCommandEntry {
  name: string; // e.g. "compact", "dr"
  description: string; // first line of .md file, or built-in description
  source: 'builtin' | 'user' | 'project';
}

// --- Prompt Snippets ---

export interface SnippetVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface SnippetEntry {
  name: string;
  description: string;
  source: 'user' | 'project';
  variables: SnippetVariable[];
  body: string;
  filePath: string;
}
