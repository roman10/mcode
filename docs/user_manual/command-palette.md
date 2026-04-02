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

- **General** — New Session, New Codex Session, New Gemini Session, New Copilot Session, New Terminal, New Task, Run Shell Command, Search in Files, Settings, Keyboard Shortcuts, Snippets, Prompt History, and Show Todos
- **Layout** — terminal-panel actions (toggle panel, split terminal, close terminal, cycle tabs), Toggle Sidebar, Show Sessions/Changes/Stats/Activity/Todos, Switch to Kanban/Tiles, Close All Tiles, Close Tile, Split Horizontal/Vertical
- **Session** — Clear All Attention, Kill Session, Delete Session, plus a dynamic entry per open session for quick-jumping

Each command shows its keyboard shortcut (if one exists).

## Specialized Palettes

You can switch between specialized search modes by typing a prefix in the palette:

| Prefix | Mode | Shortcut | Description |
|---|---|---|---|
| `>` | **Commands** | `Cmd+Shift+P` | Run app commands and actions |
| `!` | **Shell** | `Cmd+Shift+E` | Run a shell command in the active terminal |
| `@` | **Snippets** | `Cmd+Shift+S` | Insert reusable prompt templates |
| `#` | **History** | `Cmd+Shift+H` | Search and reuse previous prompts |
| `+` | **Todos** | `Cmd+Shift+I` | Add or search TODO items |
| (none) | **Files** | `Cmd+P` | Fuzzy search files by name |

### Shell Palette (`!`)

Type `!` to quickly run a one-off shell command. The command is sent to the currently focused terminal tile.

### Snippet Palette (`@`)

Snippets are reusable prompt templates stored as Markdown files.

- **Search**: Fuzzy search across snippet name and description
- **Variables**: If a snippet has `{{placeholder}}` variables, a form appears to fill them in before insertion
- **Source**: Snippets can be project-specific (`<project>/.mcode/snippets/`) or global (`~/.mcode/snippets/`)

### Prompt History Palette (`#`)

Search through your previous prompts across all sessions. Selecting a history item inserts it into the active terminal.

### Todo Palette (`+`)

Search for existing TODOs or add a new manual TODO. Manual TODOs are stored in the mcode database and appear in the **Todos** sidebar tab.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+P` | Open Quick Open (file search) |
| `Cmd+Shift+P` | Open Command Palette (commands) |
| `Cmd+Shift+S` | Open snippets (`@` mode) |
| `Cmd+Shift+H` | Open prompt history (`#` mode) |
| `Cmd+Shift+E` | Run shell command (`!` mode) |
| `Cmd+Shift+I` | Show todos (`+` mode) |
| Arrow keys | Navigate results |
| `Enter` | Select result |
| `Escape` | Close |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.
