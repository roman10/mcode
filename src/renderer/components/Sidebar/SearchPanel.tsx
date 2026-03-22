import { useEffect, useRef, useCallback } from 'react';
import { Search, CaseSensitive, Regex, ChevronRight, ChevronDown, X } from 'lucide-react';
import { useSearchStore, type RepoResults } from '../../stores/search-store';
import { useLayoutStore } from '../../stores/layout-store';
import { getFileIcon } from '../../utils/file-icons';
import type { FileSearchMatch } from '../../../shared/types';

// --- Highlighted match text ---

function HighlightedLine({ lineContent, column, matchLength }: {
  lineContent: string;
  column: number;
  matchLength: number;
}): React.JSX.Element {
  const start = column - 1; // column is 1-based
  const end = start + matchLength;

  if (start < 0 || end > lineContent.length) {
    return <span className="truncate">{lineContent}</span>;
  }

  return (
    <span className="truncate">
      {lineContent.slice(0, start)}
      <span className="text-accent font-medium bg-accent/15">{lineContent.slice(start, end)}</span>
      {lineContent.slice(end)}
    </span>
  );
}

// --- Match line ---

function MatchLine({ match, repoPath, onSelect }: {
  match: FileSearchMatch;
  repoPath: string;
  onSelect: (repoPath: string, filePath: string, line: number) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="w-full text-left flex items-start gap-1.5 pl-10 pr-2 py-0.5 text-xs hover:bg-bg-elevated cursor-pointer group"
      onClick={() => onSelect(repoPath, match.path, match.line)}
    >
      <span className="shrink-0 text-text-muted w-8 text-right tabular-nums">{match.line}</span>
      <span className="min-w-0 flex-1 font-mono text-text-secondary truncate">
        <HighlightedLine
          lineContent={match.lineContent}
          column={match.column}
          matchLength={match.matchLength}
        />
      </span>
    </button>
  );
}

// --- File group ---

function FileGroup({ filePath, matches, repoPath, expanded, onToggle, onSelect }: {
  filePath: string;
  matches: FileSearchMatch[];
  repoPath: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (repoPath: string, filePath: string, line: number) => void;
}): React.JSX.Element {
  const lastSlash = filePath.lastIndexOf('/');
  const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const directory = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';

  return (
    <div>
      <button
        type="button"
        className="w-full text-left flex items-center gap-1 pl-6 pr-2 py-0.5 text-xs hover:bg-bg-elevated cursor-pointer"
        onClick={onToggle}
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0 text-text-muted" />
          : <ChevronRight size={12} className="shrink-0 text-text-muted" />}
        <span className="shrink-0">{getFileIcon(filename)}</span>
        <span className="truncate text-text-primary">{filename}</span>
        {directory && (
          <span className="truncate text-text-muted ml-1">{directory}</span>
        )}
        <span className="shrink-0 ml-auto text-text-muted tabular-nums">{matches.length}</span>
      </button>
      {expanded && matches.map((match, i) => (
        <MatchLine key={`${match.line}:${i}`} match={match} repoPath={repoPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

// --- Repo group ---

function RepoGroup({ repoPath, repo, expanded, expandedFiles, onToggleRepo, onToggleFile, onSelect }: {
  repoPath: string;
  repo: RepoResults;
  expanded: boolean;
  expandedFiles: Set<string>;
  onToggleRepo: () => void;
  onToggleFile: (repoPath: string, filePath: string) => void;
  onSelect: (repoPath: string, filePath: string, line: number) => void;
}): React.JSX.Element {
  const fileCount = repo.files.size;

  return (
    <div>
      <button
        type="button"
        className="w-full text-left flex items-center gap-1 px-2 py-1 text-xs font-medium hover:bg-bg-elevated cursor-pointer"
        onClick={onToggleRepo}
      >
        {expanded
          ? <ChevronDown size={14} className="shrink-0 text-text-muted" />
          : <ChevronRight size={14} className="shrink-0 text-text-muted" />}
        <span className="truncate text-text-primary">{repo.repoName}</span>
        <span className="shrink-0 ml-auto text-text-muted tabular-nums text-xs">
          {repo.matchCount} in {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      </button>
      {expanded && [...repo.files.entries()].map(([filePath, matches]) => {
        const fileKey = `${repoPath}\0${filePath}`;
        const isFileExpanded = expandedFiles.has(fileKey);
        return (
          <FileGroup
            key={filePath}
            filePath={filePath}
            matches={matches}
            repoPath={repoPath}
            expanded={isFileExpanded}
            onToggle={() => onToggleFile(repoPath, filePath)}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

// --- Main panel ---

function SearchPanel(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useSearchStore((s) => s.query);
  const isRegex = useSearchStore((s) => s.isRegex);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const searching = useSearchStore((s) => s.searching);
  const results = useSearchStore((s) => s.results);
  const totalMatches = useSearchStore((s) => s.totalMatches);
  const totalFiles = useSearchStore((s) => s.totalFiles);
  const truncated = useSearchStore((s) => s.truncated);
  const durationMs = useSearchStore((s) => s.durationMs);
  const error = useSearchStore((s) => s.error);
  const expandedRepos = useSearchStore((s) => s.expandedRepos);
  const expandedFiles = useSearchStore((s) => s.expandedFiles);

  const setQuery = useSearchStore((s) => s.setQuery);
  const toggleRegex = useSearchStore((s) => s.toggleRegex);
  const toggleCaseSensitive = useSearchStore((s) => s.toggleCaseSensitive);
  const toggleRepo = useSearchStore((s) => s.toggleRepo);
  const toggleFile = useSearchStore((s) => s.toggleFile);
  const clear = useSearchStore((s) => s.clear);

  // Focus input when panel becomes active
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);
  useEffect(() => {
    if (activeSidebarTab === 'search') {
      // Small delay to ensure DOM is ready after tab switch
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [activeSidebarTab]);

  // Listen for the search-in-files command to focus input
  useEffect(() => {
    const unsub = window.mcode.app.onCommand((cmd) => {
      if (cmd.command === 'search-in-files') {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    });
    return unsub;
  }, []);

  const handleSelect = useCallback((repoPath: string, filePath: string, line: number) => {
    const absolutePath = repoPath.endsWith('/')
      ? repoPath + filePath
      : `${repoPath}/${filePath}`;
    useLayoutStore.getState().addFileViewer(absolutePath, { line });
    useLayoutStore.getState().persist();
  }, []);

  const repoCount = results.size;
  const isSingleRepo = repoCount === 1;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0">
        <span className="text-xs text-text-secondary uppercase tracking-wide">Search</span>
        {query && (
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={clear}
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Search input area */}
      <div className="px-2 py-2 border-b border-border-default shrink-0">
        <div className="flex items-center gap-1 bg-bg-primary rounded border border-border-default focus-within:border-border-focus px-2">
          <Search size={14} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files..."
            className="flex-1 bg-transparent text-sm text-text-primary py-1.5 outline-none placeholder:text-text-muted min-w-0"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (query) clear();
              }
            }}
          />
          <button
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
              isRegex ? 'text-accent bg-accent/15' : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
            }`}
            onClick={toggleRegex}
            title="Use Regular Expression"
          >
            <Regex size={14} />
          </button>
          <button
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
              caseSensitive ? 'text-accent bg-accent/15' : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
            }`}
            onClick={toggleCaseSensitive}
            title="Match Case"
          >
            <CaseSensitive size={14} />
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-xs text-red-400">{error}</div>
        )}

        {!query.trim() && !error && (
          <div className="px-3 py-6 text-center text-xs text-text-muted">
            Type to search across files in all session repos.
          </div>
        )}

        {query.trim() && !searching && totalMatches === 0 && !error && (
          <div className="px-3 py-6 text-center text-xs text-text-muted">
            No results found.
          </div>
        )}

        {/* Single repo: skip repo grouping, show files directly */}
        {isSingleRepo && [...results.entries()].map(([repoPath, repo]) => (
          <div key={repoPath}>
            {[...repo.files.entries()].map(([filePath, matches]) => {
              const fileKey = `${repoPath}\0${filePath}`;
              const isExpanded = expandedFiles.has(fileKey);
              return (
                <FileGroup
                  key={filePath}
                  filePath={filePath}
                  matches={matches}
                  repoPath={repoPath}
                  expanded={isExpanded}
                  onToggle={() => toggleFile(repoPath, filePath)}
                  onSelect={handleSelect}
                />
              );
            })}
          </div>
        ))}

        {/* Multi-repo: show repo → file → match hierarchy */}
        {!isSingleRepo && [...results.entries()].map(([repoPath, repo]) => (
          <RepoGroup
            key={repoPath}
            repoPath={repoPath}
            repo={repo}
            expanded={expandedRepos.has(repoPath)}
            expandedFiles={expandedFiles}
            onToggleRepo={() => toggleRepo(repoPath)}
            onToggleFile={toggleFile}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Status bar */}
      {(searching || totalMatches > 0) && (
        <div className="flex items-center px-3 py-1 border-t border-border-default shrink-0 text-xs text-text-muted">
          {searching ? (
            <span className="animate-pulse">Searching...</span>
          ) : (
            <span>
              {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
              {repoCount > 1 && ` across ${repoCount} repos`}
              {durationMs !== null && ` (${durationMs}ms)`}
              {truncated && ' — results truncated'}
            </span>
          )}
        </div>
      )}
    </>
  );
}

export default SearchPanel;
