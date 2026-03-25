import { LayoutList, Search, BarChart3, FileDiff, Activity, Users, Settings } from 'lucide-react';
import Tooltip from '../shared/Tooltip';
import { formatKeys } from '../../utils/format-shortcut';
import type { SidebarTab } from '@shared/types';

function ActivityBarButton({ icon, tab, active, panelCollapsed, onSelect, tooltip, badge }: {
  icon: React.ReactNode;
  tab: SidebarTab;
  active: SidebarTab;
  panelCollapsed: boolean;
  onSelect: (tab: SidebarTab) => void;
  tooltip: string;
  badge?: number;
}): React.JSX.Element {
  const isActive = active === tab && !panelCollapsed;
  return (
    <Tooltip content={tooltip} side="right">
      <button
        className={`relative w-12 h-12 flex items-center justify-center transition-colors ${
          isActive
            ? 'text-text-primary border-l-2 border-accent'
            : 'text-text-muted hover:text-text-secondary border-l-2 border-transparent'
        }`}
        onClick={() => onSelect(tab)}
      >
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute top-1.5 right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-accent text-xs font-medium text-bg-primary px-1">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function ActivityBar({ activeTab, panelCollapsed, onTabSelect, onSettingsClick, onAccountsClick, attentionCount, changesCount }: {
  activeTab: SidebarTab;
  panelCollapsed: boolean;
  onTabSelect: (tab: SidebarTab) => void;
  onSettingsClick: () => void;
  onAccountsClick: () => void;
  attentionCount: number;
  changesCount?: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-col h-full w-12 bg-bg-primary border-r border-border-default shrink-0">
      {/* Tab icons */}
      <div className="flex flex-col">
        <ActivityBarButton
          icon={<LayoutList size={20} strokeWidth={1.5} />}
          tab="sessions"
          active={activeTab}
          panelCollapsed={panelCollapsed}
          onSelect={onTabSelect}
          tooltip="Sessions"
          badge={attentionCount}
        />
        <ActivityBarButton
          icon={<Search size={20} strokeWidth={1.5} />}
          tab="search"
          active={activeTab}
          panelCollapsed={panelCollapsed}
          onSelect={onTabSelect}
          tooltip={`Search in Files (${formatKeys('Shift+F', true)})`}
        />
        <ActivityBarButton
          icon={<FileDiff size={20} strokeWidth={1.5} />}
          tab="changes"
          active={activeTab}
          panelCollapsed={panelCollapsed}
          onSelect={onTabSelect}
          tooltip={`Changes (${formatKeys('Shift+C', true)})`}
          badge={changesCount}
        />
        <ActivityBarButton
          icon={<BarChart3 size={20} strokeWidth={1.5} />}
          tab="stats"
          active={activeTab}
          panelCollapsed={panelCollapsed}
          onSelect={onTabSelect}
          tooltip={`Stats (${formatKeys('Shift+B', true)})`}
        />
        <ActivityBarButton
          icon={<Activity size={20} strokeWidth={1.5} />}
          tab="activity"
          active={activeTab}
          panelCollapsed={panelCollapsed}
          onSelect={onTabSelect}
          tooltip={`Activity (${formatKeys('Shift+A', true)})`}
        />
      </div>

      {/* Bottom icons */}
      <div className="mt-auto flex flex-col">
        <Tooltip content="Accounts" side="right">
          <button
            className="w-12 h-12 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
            onClick={onAccountsClick}
          >
            <Users size={20} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content={`Settings (${formatKeys(',', true)})`} side="right">
          <button
            className="w-12 h-12 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
            onClick={onSettingsClick}
          >
            <Settings size={20} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

export default ActivityBar;
