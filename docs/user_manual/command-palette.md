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

- **General** — New Session, New Codex Session, New Gemini Session, New Copilot Session, New Terminal, New Task, Run Shell Command, Search in Files, Settings, Keyboard Shortcuts, and Snippets: Insert
- **Layout** — terminal-panel actions (toggle panel, split terminal, close terminal, cycle tabs), Toggle Sidebar, Show Sessions/Changes/Stats/Activity, Switch to Kanban/Tiles, Close All Tiles, Close Tile, Split Horizontal/Vertical
- **Session** — Clear All Attention, Kill Session, Delete Session, plus a dynamic entry per open session for quick-jumping

Each command shows its keyboard shortcut (if one exists). Commands are context-aware — for example, "Kill Session" is disabled when no active session is selected.

`New Gemini Session` and `New Copilot Session` open the regular new-session dialog with that agent preselected, so you can launch those flows without manually changing the agent selector first.

## Snippet Palette (`@` mode)

Type `@` in Quick Open to switch to snippet mode. Snippets are reusable prompt templates stored as Markdown files.

- **Search**: Fuzzy search across snippet name and description
- **No variables**: Selecting a snippet inserts its body directly into the active terminal
- **With variables**: A form appears with labeled inputs (pre-filled with defaults). Press Enter or click Insert to render the template and insert it
- **Escape in form**: Returns to snippet search (does not close the palette)
- **Source badge**: Each snippet shows "Project" or "User" to indicate where it comes from

### Snippet file format

Snippets are `.md` files stored in `~/.mcode/snippets/` (user-level) or `<project>/.mcode/snippets/` (project-level). Project snippets override user snippets with the same name.

```markdown
---
name: Review PR
description: Review a pull request with focus areas
variables:
  - name: branch
    description: Branch to review
    default: main
  - name: focus
    description: Focus area
---
Review the changes in {{branch}} branch. Focus on {{focus}}.
```

If no `variables` are defined in the frontmatter, `{{placeholder}}` patterns are auto-extracted from the body.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+P` | Open Quick Open (file search) |
| `Cmd+Shift+P` | Open Command Palette (commands) |
| `Cmd+Shift+S` | Open snippets |
| `@` (in Quick Open) | Switch to snippet search |
| Arrow keys | Navigate results |
| `Enter` | Select result |
| `Escape` | Close |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.
