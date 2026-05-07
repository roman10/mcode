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

- **General** — New Session (per agent: Claude / Codex / Gemini / Copilot), New Terminal, New Task, New Plan Mode Response, Run Shell Command, Search in Files, Settings, Keyboard Shortcuts, Prompt Library, Snippets: New, Snippets: Open Folder, Todos: Add / Search, and Memory Inspector (diagnostics)
- **Layout** — terminal-panel actions (toggle panel, split terminal, close terminal, cycle tabs), Toggle Sidebar, Show Sessions/Changes/Stats/Activity/Todos, Switch to Kanban/Tiles, Close All Tiles, Close Tile, Split Horizontal/Vertical
- **Session** — Clear All Attention, Kill Session, Delete Session, plus a dynamic entry per open session for quick-jumping

Each command shows its keyboard shortcut (if one exists).

## Specialized Palettes

You can switch between specialized search modes by typing a prefix in the palette:

| Prefix | Mode | Shortcut | Description |
|---|---|---|---|
| `>` | **Commands** | `Cmd+Shift+P` | Run app commands and actions |
| `!` | **Shell** | `Cmd+Shift+E` | Run a shell command in the active terminal |
| `@` | **Prompt Library** | `Cmd+Shift+S` | Browse pinned snippets and recent prompt history |
| `+` | **Todos** | `Cmd+Shift+I` | Add or search TODO items |
| (none) | **Files** | `Cmd+P` | Fuzzy search files by name |

### Shell Palette (`!`)

Type `!` to run a one-off shell command. The command is sent to the focused terminal tile. The palette also surfaces commands from your shell history file (`$HISTFILE`) for quick reuse.

### Prompt Library Palette (`@`)

The Prompt Library combines reusable snippets and your prompt history into a single searchable view. Pin a recent prompt to keep it at the top, or save it as a named snippet for reuse across sessions.

- **Search**: fuzzy match across snippet name, description, and previously sent prompts
- **Variables**: if a snippet has `{{placeholder}}` variables, a form appears to fill them in before insertion
- **Sources**: snippets are stored as Markdown files, project-specific (`<project>/.mcode/snippets/`) or global (`~/.mcode/snippets/`). The Command Palette has **Snippets: New** and **Snippets: Open Folder** entries to author and manage them.
- **Insertion**: selecting an item inserts it into the focused terminal (or the focused terminal in the bottom panel)

### Todo Palette (`+`)

Search for existing TODOs or add a new manual TODO. Manual TODOs are stored in the mcode database and appear in the **Todos** sidebar tab.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+P` | Open Quick Open (file search) |
| `Cmd+Shift+P` | Open Command Palette (commands) |
| `Cmd+Shift+S` | Open Prompt Library (`@` mode) |
| `Cmd+Shift+E` | Run shell command (`!` mode) |
| `Cmd+Shift+I` | Show todos (`+` mode) |
| Arrow keys | Navigate results |
| `Enter` | Select result |
| `Escape` | Close |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.
