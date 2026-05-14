import type { MosaicNode } from 'react-mosaic-component';

export type SidebarTab = 'sessions' | 'search' | 'changes' | 'stats' | 'activity' | 'todos';
export type ViewMode = 'tiles' | 'kanban';

export interface LayoutStateSnapshot {
  mosaicTree: MosaicNode<string> | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTab;
  terminalPanelState?: unknown;
}
