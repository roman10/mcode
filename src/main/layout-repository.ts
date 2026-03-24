import { getDb } from './db';

interface LayoutRow {
  mosaic_tree: string;
  sidebar_width: number;
  sidebar_collapsed: number;
  active_sidebar_tab: string | null;
}

export interface LayoutSnapshot {
  mosaicTree: unknown;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: string;
}

export class LayoutRepository {
  save(mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string): void {
    const db = getDb();
    if (mosaicTree === null || mosaicTree === undefined) {
      db.prepare('DELETE FROM layout_state WHERE id = 1').run();
      return;
    }
    const json = JSON.stringify(mosaicTree);
    const width = sidebarWidth ?? 280;
    const collapsed = sidebarCollapsed ? 1 : 0;
    const tab = activeSidebarTab ?? 'sessions';
    db.prepare(
      `INSERT INTO layout_state (id, mosaic_tree, sidebar_width, sidebar_collapsed, active_sidebar_tab, updated_at)
       VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET mosaic_tree = ?, sidebar_width = ?, sidebar_collapsed = ?, active_sidebar_tab = ?, updated_at = datetime('now')`,
    ).run(json, width, collapsed, tab, json, width, collapsed, tab);
  }

  load(): LayoutSnapshot | null {
    const db = getDb();
    const row = db
      .prepare('SELECT mosaic_tree, sidebar_width, sidebar_collapsed, active_sidebar_tab FROM layout_state WHERE id = 1')
      .get() as LayoutRow | undefined;
    if (!row) return null;
    try {
      return {
        mosaicTree: JSON.parse(row.mosaic_tree),
        sidebarWidth: row.sidebar_width,
        sidebarCollapsed: Boolean(row.sidebar_collapsed),
        activeSidebarTab: row.active_sidebar_tab ?? 'sessions',
      };
    } catch {
      return null;
    }
  }
}
