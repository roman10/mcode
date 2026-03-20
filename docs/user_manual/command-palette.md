# Command Palette & Quick Open

## Quick Open (`Cmd+P`)

Fuzzy-search files across all open sessions. Also opened by clicking the project name in the title bar.

- Results update as you type, powered by fuzzy matching
- Each result shows a file icon colored by language/extension
- When multiple repos are open, a repo label badge appears next to each result to disambiguate
- Select a result to open the file in the built-in viewer

## Command Palette (`Cmd+Shift+P`)

Opens the same dialog in command mode (input prefilled with `>`). You can also open Quick Open with `Cmd+P` and type `>` to switch.

Commands are grouped into three categories:

- **General** — New Session, New Terminal, New Task, Settings, Keyboard Shortcuts
- **Layout** — Toggle Sidebar, Show Sessions/Commits/Token Usage/Activity, Switch to Kanban/Tiles, Close All Tiles, Close Tile, Split Horizontal/Vertical
- **Session** — Clear All Attention, Kill Session, Delete Session, plus a dynamic entry per open session for quick-jumping

Each command shows its keyboard shortcut (if one exists). Commands are context-aware — for example, "Kill Session" is disabled when no active session is selected.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+P` | Open Quick Open (file search) |
| `Cmd+Shift+P` | Open Command Palette (commands) |
| Arrow keys | Navigate results |
| `Enter` | Select result |
| `Escape` | Close |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.
