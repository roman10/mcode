import { getDb } from '../db';
import { typedHandle } from '../ipc-helpers';
import type { LayoutStateSnapshot } from '../../shared/types';

interface LayoutRow {
  mosaic_tree: string;
  sidebar_width: number;
  sidebar_collapsed: number;
  active_sidebar_tab: string | null;
  terminal_panel_state: string | null;
}

export interface LayoutSnapshot {
  mosaicTree: unknown;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: string;
  terminalPanelState: unknown | null;
}

export class LayoutRepository {
  save(mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string, terminalPanelState?: unknown): void {
    const db = getDb();
    if (mosaicTree === null || mosaicTree === undefined) {
      db.prepare('DELETE FROM layout_state WHERE id = 1').run();
      return;
    }
    const json = JSON.stringify(mosaicTree);
    const width = sidebarWidth ?? 280;
    const collapsed = sidebarCollapsed ? 1 : 0;
    const tab = activeSidebarTab ?? 'sessions';
    const panelJson = terminalPanelState ? JSON.stringify(terminalPanelState) : null;
    db.prepare(
      `INSERT INTO layout_state (id, mosaic_tree, sidebar_width, sidebar_collapsed, active_sidebar_tab, terminal_panel_state, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET mosaic_tree = ?, sidebar_width = ?, sidebar_collapsed = ?, active_sidebar_tab = ?, terminal_panel_state = ?, updated_at = datetime('now')`,
    ).run(json, width, collapsed, tab, panelJson, json, width, collapsed, tab, panelJson);
  }

  load(): LayoutSnapshot | null {
    const db = getDb();
    const row = db
      .prepare('SELECT mosaic_tree, sidebar_width, sidebar_collapsed, active_sidebar_tab, terminal_panel_state FROM layout_state WHERE id = 1')
      .get() as LayoutRow | undefined;
    if (!row) return null;
    try {
      return {
        mosaicTree: JSON.parse(row.mosaic_tree),
        sidebarWidth: row.sidebar_width,
        sidebarCollapsed: Boolean(row.sidebar_collapsed),
        activeSidebarTab: row.active_sidebar_tab ?? 'sessions',
        terminalPanelState: row.terminal_panel_state ? JSON.parse(row.terminal_panel_state) : null,
      };
    } catch {
      return null;
    }
  }
}

export function registerLayoutIpc(layoutRepo: LayoutRepository): void {
  typedHandle('layout:save', (mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState) => {
    layoutRepo.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState);
  });

  typedHandle('layout:load', () => {
    return (layoutRepo.load() ?? null) as LayoutStateSnapshot | null;
  });
}
