# Getting Started with mcode

mcode is a desktop IDE for managing multiple autonomous Claude Code sessions simultaneously. This guide walks you through installation, launching the app, and core workflows.

## Prerequisites

- **macOS** (primary supported platform)
- **Node.js** (v20+) and **npm**
- **Claude Code CLI** installed and authenticated (`claude` command available in your terminal)

## Installation

```bash
git clone <repo-url>
cd mcode
npm install
```

## Launching the App

**Development mode** (with hot reload):

```bash
npm run dev
```

**Production build:**

```bash
npm run build:mac
```

## The Interface

When you launch mcode, you see two main areas:

1. **Sidebar** (left) — tabs for sessions, commits, tokens, and activity
2. **Main area** (right) — a tiling layout (or kanban board) where terminal tiles are displayed

### Sidebar

The sidebar has a **tab bar** at the top with five tabs:

- **Sessions** — session list grouped by date, plus the task queue
- **Commits** — commit statistics for the day (see [Sidebar Panels](sidebar-panels.md#commit-tracking))
- **Changes** — git changes (staged/unstaged) and commit graph (see [Git Changes](git-changes.md) and [Sidebar Panels](sidebar-panels.md#changes))
- **Tokens** — token usage and estimated cost (see [Sidebar Panels](sidebar-panels.md#token-usage))
- **Activity** — live event feed from all sessions (see [Sidebar Panels](sidebar-panels.md#activity-feed))

Switch tabs by clicking the icons or with `Cmd+Shift+B` (Commits), `Cmd+Shift+C` (Changes), `Cmd+Shift+U` (Tokens), `Cmd+Shift+A` (Activity).

On the **Sessions tab**, action buttons appear to the right of the tab bar: Close all tiles, Delete ended sessions, Mark all read, New terminal (`Cmd+T`), and New session (`Cmd+N`).

The session list shows all sessions grouped by date (Today, Yesterday, then by date):

- **Green dot** — Active session (Claude Code is running)
- **Blue dot** — Idle (session is waiting for input)
- **Red dot** — Waiting (e.g., awaiting permission approval)
- **Amber dot** — Starting (session is initializing)
- **Neutral dot** — Detached (PTY connection lost, e.g., after an unclean shutdown; the process may still be running)
- **Gray dot** — Ended (session has terminated)

Sessions with raised attention show a colored left border (red, amber, or blue) to draw your eye. See [Attention & Tasks](attention-and-tasks.md) for details.

You can resize the sidebar by dragging its right edge (200px–500px range).

The **sidebar footer** shows the "mcode" label, today's estimated token cost, an Accounts button, and a [Settings](settings.md) button.

### Tile Toolbar

Each terminal tile has a toolbar showing the session status, label, and uptime. Toolbar buttons:

- **Maximize/Restore** — toggle between a single maximized tile and the full layout (also `Cmd+Enter`)
- **Kill** (square icon) — terminates the Claude Code process
- **Close** (X icon) — hides the tile; the session keeps running in the background

Double-click the title in the toolbar to rename the session inline.

## Creating Your First Session

1. Click the **+** button in the sidebar header (or press `Cmd+N`)
2. In the dialog that appears, fill in:
   - **Working directory** (required) — click "Browse" to select a project folder, or type a path
   - **Label** (optional) — a name for the session; defaults to the folder name
   - **Initial prompt** (optional) — what you want Claude to work on
   - **Permission mode** (optional) — controls how Claude handles tool permissions (`default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`)
   - **Effort** (optional) — controls reasoning depth (`low`, `medium`, `high`, `max`)
   - **Account** (shown when multiple accounts are configured) — select which Claude account to use
   - **Run in isolated worktree** (checkbox) — creates a git worktree so the session works on an isolated branch; optional branch name field appears when checked
3. Click **Create Session**

A new terminal tile opens in the main area and Claude Code starts in your chosen directory. Last-used defaults (directory, permission mode, effort) are remembered.

You can also open a plain terminal with `Cmd+T` (the terminal icon in the sidebar header).

## Working with Sessions

### Interacting with a Terminal

Click inside a terminal tile to focus it, then type as you would in any terminal. Claude Code runs inside the terminal — you can send prompts, approve tool calls, and see output in real time.

### Renaming a Session

Double-click the session name in the sidebar or the tile toolbar to edit it inline. Press **Enter** to save or **Escape** to cancel.

### Closing vs. Killing a Session

- **Close** (toolbar X icon or `Cmd+W`) — hides the tile but the session keeps running in the background. You can reopen it later.
- **Kill** (toolbar square icon or `Cmd+Shift+W`) — terminates the Claude Code process. The session moves to "Ended" status.

### Reopening a Closed Session

Hover over the session in the sidebar and click the **+** button to reopen its tile in the layout.

### Context Menu

Right-click any session card in the sidebar to open a context menu with quick actions:

- **Rename** (shortcut: `F2`) — start inline renaming
- **Open Tile** — open the session's tile in the current layout (running sessions)
- **View / Resume** — open a tile for the session's output (ended sessions)
- **Kill Session** — terminate the Claude Code process
- **Delete Session** — permanently remove the session record (ended sessions only)

## Tiling Layout

mcode uses a tiling window manager so you can view multiple sessions side by side.

- **Resize tiles** — drag the dividers between tiles
- **Rearrange tiles** — drag tiles to reorder them in the layout
- **Split** — `Cmd+D` (horizontal) or `Cmd+Shift+D` (vertical) to split the focused tile
- **Maximize** — `Cmd+Enter` to toggle a tile between maximized and tiled
- Your layout is automatically saved and restored on next launch

## Command Palette & Quick Open

Press `Cmd+P` to open Quick Open for fast file search across all sessions. Press `Cmd+Shift+P` for the Command Palette to run any command by name. You can also click the project name in the title bar to open Quick Open.

See [Command Palette & Quick Open](command-palette.md) for full details.

## Kanban View

Press `Cmd+Shift+L` to toggle between the tiling layout and a kanban board that groups sessions into columns: Needs Attention, Working, Ready, and Completed.

See [Kanban View](kanban-view.md) for full details.

## Keyboard Shortcuts

Press `Cmd+/` to see the full shortcut reference. A few essentials:

| Shortcut | Action |
|---|---|
| `Cmd+N` | New Claude session |
| `Cmd+T` | New terminal |
| `Cmd+P` | Quick Open |
| `Cmd+Shift+P` | Command Palette |
| `Cmd+1`–`9` | Focus session by position |
| `Cmd+W` | Close tile |
| `Cmd+Enter` | Maximize / restore tile |
| `Cmd+F` | Find in terminal |
| `Cmd+Shift+T` | New task |
| `Cmd+Shift+L` | Toggle layout mode |
| `Cmd+,` | Settings |
| `Cmd+\` | Toggle sidebar |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.

## Tips

- Run multiple sessions in parallel to work on different tasks or different repos at the same time
- Use descriptive labels so you can quickly identify each session in the sidebar
- Close tiles you don't need to watch — the session continues running in the background
- Use the `plan` permission mode when you want Claude to propose changes before making them
- Press `Cmd+/` to discover all keyboard shortcuts
- Switch to the Activity tab (`Cmd+Shift+A`) to monitor events across all sessions at once
