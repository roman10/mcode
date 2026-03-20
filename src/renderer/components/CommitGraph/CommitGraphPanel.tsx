import { useEffect, useCallback, useState, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useGraphStore } from '../../stores/graph-store';
import { useLayoutStore } from '../../stores/layout-store';
import { computeLanes, getMaxColumn } from '../../utils/lane-algorithm';
import GraphLanes, { LANE_WIDTH } from './GraphLanes';
import CommitRow from './CommitRow';
import Tooltip from '../shared/Tooltip';

function repoBasename(repoRoot: string): string {
  const last = repoRoot.lastIndexOf('/');
  return last >= 0 ? repoRoot.slice(last + 1) : repoRoot;
}

function RepoGraphSection({ repoRoot }: { repoRoot: string }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const graphData = useGraphStore((s) => s.graphs[repoRoot]);
  const fetchMore = useGraphStore((s) => s.fetchMore);

  const commits = graphData?.commits ?? [];
  const hasMore = graphData?.hasMore ?? false;

  const rows = useMemo(() => computeLanes(commits), [commits]);
  const maxColumn = useMemo(() => getMaxColumn(rows), [rows]);

  if (commits.length === 0) {
    return (
      <div>
        <button
          className="flex items-center w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span className="ml-1 font-medium truncate">{repoBasename(repoRoot)}</span>
          <span className="ml-auto text-text-muted">0</span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex items-center w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="ml-1 font-medium truncate">{repoBasename(repoRoot)}</span>
        <span className="ml-auto text-text-muted">{commits.length}{hasMore ? '+' : ''}</span>
      </button>

      {!collapsed && (
        <div className="relative">
          {/* Graph lanes overlay positioned absolutely behind commit rows */}
          <div className="absolute left-2 top-0 pointer-events-none">
            <GraphLanes rows={rows} maxColumn={maxColumn} />
          </div>

          {/* Commit rows with left padding to clear the graph lanes */}
          <div style={{ paddingLeft: (maxColumn + 1) * LANE_WIDTH + LANE_WIDTH }}>
            {rows.map((row) => (
              <CommitRow key={row.node.hash} row={row} repoRoot={repoRoot} />
            ))}
          </div>

          {hasMore && (
            <button
              className="w-full px-3 py-1 text-xs text-accent hover:text-accent/80 transition-colors text-center"
              onClick={() => fetchMore(repoRoot)}
            >
              Show more...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CommitGraphPanel(): React.JSX.Element {
  const expanded = useGraphStore((s) => s.expanded);
  const setExpanded = useGraphStore((s) => s.setExpanded);
  const loading = useGraphStore((s) => s.loading);
  const graphs = useGraphStore((s) => s.graphs);
  const refreshAll = useGraphStore((s) => s.refreshAll);
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);

  const repoRoots = Object.keys(graphs);
  const totalCommits = Object.values(graphs).reduce((sum, g) => sum + g.commits.length, 0);

  // Load tracked repos and fetch graphs on mount / tab activation
  const loadData = useCallback(async () => {
    try {
      const repos = await window.mcode.git.getTrackedRepos();
      if (repos.length > 0) {
        await refreshAll(repos);
      }
    } catch (err) {
      console.error('Failed to load graph data:', err);
    }
  }, [refreshAll]);

  useEffect(() => {
    if (activeSidebarTab === 'changes') {
      loadData();
    }
  }, [activeSidebarTab, loadData]);

  // Subscribe to commit updates
  useEffect(() => {
    const unsub = window.mcode.commits.onUpdated(() => {
      if (expanded) {
        loadData();
      }
    });
    return unsub;
  }, [expanded, loadData]);

  const handleRefresh = (): void => {
    loadData();
  };

  return (
    <div className="border-t border-border-default">
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="text-xs text-text-secondary font-medium">Commits</span>
          {totalCommits > 0 && (
            <span className="text-xs bg-bg-elevated text-text-muted px-1 rounded">
              {totalCommits}
            </span>
          )}
        </div>
        <Tooltip content="Refresh" side="bottom">
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleRefresh();
            }}
          >
            <RefreshCw size={12} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </div>

      {expanded && (
        <div className="max-h-[50vh] overflow-y-auto">
          {repoRoots.length === 0 && !loading && (
            <div className="px-3 py-2 text-xs text-text-muted">
              No tracked repositories
            </div>
          )}
          {repoRoots.map((repoRoot) => (
            <RepoGraphSection key={repoRoot} repoRoot={repoRoot} />
          ))}
        </div>
      )}
    </div>
  );
}

export default CommitGraphPanel;
