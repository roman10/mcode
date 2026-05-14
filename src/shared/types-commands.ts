import type { AgentSessionType } from './session-agents';
import type { SidebarTab, ViewMode } from './types-layout';

// --- App Commands (menu accelerators → renderer) ---

export type AppCommand =
  | { command: 'new-session'; sessionType?: AgentSessionType }
  | { command: 'new-terminal' }
  | { command: 'focus-session-index'; index: number }
  | { command: 'focus-next-session' }
  | { command: 'focus-prev-session' }
  | { command: 'toggle-sidebar' }
  | { command: 'show-keyboard-shortcuts' }
  | { command: 'show-settings' }
  | { command: 'show-memory-inspector' }
  | { command: 'switch-sidebar-tab'; tab: SidebarTab }
  | { command: 'clear-all-attention' }
  | { command: 'close-all-tiles' }
  | { command: 'show-command-palette' }
  | { command: 'quick-open' }
  | { command: 'show-create-task' }
  | { command: 'show-create-task-plan-response' }
  | { command: 'set-view-mode'; mode: ViewMode }
  | { command: 'toggle-view-mode' }
  | { command: 'run-shell-command' }
  | { command: 'search-in-files' }
  | { command: 'open-snippets' }
  | { command: 'open-todos' }
  | { command: 'toggle-terminal-panel' }
  | { command: 'split-terminal-horizontal' }
  | { command: 'split-terminal-vertical' }
  | { command: 'close-terminal' }
  | { command: 'cycle-terminal-tab'; direction: 1 | -1 };
