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

1. **Sidebar** (left) — lists all your sessions with status indicators
2. **Main area** (right) — a tiling layout where terminal tiles are displayed

### Sidebar

The sidebar shows all sessions grouped by date (Today, Yesterday, then by date):

- **Green dot** — Active session (Claude Code is running)
- **Blue dot** — Idle (session is waiting for input)
- **Red dot** — Waiting (needs attention)
- **Amber dot** — Starting (session is initializing)
- **Gray dot** — Ended (session has terminated)

Sessions with raised attention show a colored left border (red, amber, or blue) to draw your eye. See [Attention & Tasks](attention-and-tasks.md) for details.

You can resize the sidebar by dragging its right edge (200px–500px range).

The sidebar footer has toggle buttons for [Commit Tracking](dashboard.md#commit-tracking), [Activity Feed](dashboard.md#activity-feed), and [Settings](settings.md).

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
3. Click **Create Session**

A new terminal tile opens in the main area and Claude Code starts in your chosen directory.

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

## Tiling Layout

mcode uses a tiling window manager so you can view multiple sessions side by side.

- **Resize tiles** — drag the dividers between tiles
- **Rearrange tiles** — drag tiles to reorder them in the layout
- **Split** — `Cmd+D` (horizontal) or `Cmd+Shift+D` (vertical) to split the focused tile
- **Maximize** — `Cmd+Enter` to toggle a tile between maximized and tiled
- Your layout is automatically saved and restored on next launch

## Keyboard Shortcuts

Press `Cmd+/` to see the full shortcut reference. A few essentials:

| Shortcut | Action |
|---|---|
| `Cmd+N` | New Claude session |
| `Cmd+T` | New terminal |
| `Cmd+1`–`9` | Focus session by position |
| `Cmd+W` | Close tile |
| `Cmd+Enter` | Maximize / restore tile |
| `Cmd+F` | Find in terminal |
| `Cmd+,` | Settings |
| `Cmd+\` | Toggle sidebar |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.

## Tips

- Run multiple sessions in parallel to work on different tasks or different repos at the same time
- Use descriptive labels so you can quickly identify each session in the sidebar
- Close tiles you don't need to watch — the session continues running in the background
- Use the `plan` permission mode when you want Claude to propose changes before making them
- Press `Cmd+/` to discover all keyboard shortcuts
- Toggle the [Activity Feed](dashboard.md#activity-feed) to monitor events across all sessions at once
