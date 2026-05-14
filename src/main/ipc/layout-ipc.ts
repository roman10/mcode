import type { LayoutRepository } from '../session/layout-repository';
import type { LayoutStateSnapshot } from '../../shared/types';
import { typedHandle } from '../ipc-helpers';

export function registerLayoutIpc(layoutRepo: LayoutRepository): void {
  typedHandle('layout:save', (mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState) => {
    layoutRepo.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState);
  });

  typedHandle('layout:load', () => {
    return (layoutRepo.load() ?? null) as LayoutStateSnapshot | null;
  });
}
