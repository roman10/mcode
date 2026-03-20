# Kanban View

An alternative to the default tiling layout that groups sessions into columns by status.

**Toggle:** Press `Cmd+Shift+L`, or use the Command Palette ("Toggle Layout Mode"). Your view mode preference is persisted across restarts.

## Columns

| Column | Color | Sessions shown |
|---|---|---|
| Needs Attention | Red | High/medium attention, or waiting for input |
| Working | Blue | Starting or actively running |
| Ready | Green | Idle (waiting for a prompt) |
| Completed | Gray | Ended |

Sessions with raised attention are placed in "Needs Attention" regardless of their run status. Within each column, sessions are sorted by attention level first, then by recency.

## Cards

Each card shows:

- Status badge (colored dot)
- Session label
- Account name (if not the default account)
- Relative time since session started
- Working directory
- Last tool used (for running sessions)
- Attention border (red/amber/blue left border matching the [attention system](attention-and-tasks.md))

### Actions

- **Click** a card to select it
- **Double-click** (or click "Open") to expand the session to a full terminal view
- **Hover** to reveal action buttons:
  - **Kill** — terminates the Claude process (running sessions only)
  - **Delete** — permanently removes the session (ended sessions only)
  - **Open** — expand to full terminal view

Use `Cmd+Enter` to expand the selected session from the board.

The **Completed** column has a "Clear all" button that deletes all ended sessions after confirmation.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+L` | Toggle between tiles and kanban |
| `Cmd+Enter` | Expand selected session to full terminal |
