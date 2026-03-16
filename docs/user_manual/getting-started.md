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

The sidebar shows all sessions grouped by status:

- **Green dot** — Active session (Claude Code is running)
- **Amber dot** — Starting (session is initializing)
- **Gray dot** — Ended (session has terminated)

Sessions are sorted with active ones first, then starting, then ended — most recent first within each group.

You can resize the sidebar by dragging its right edge (200px–500px range).

## Creating Your First Session

1. Click the **+** button in the sidebar header
2. In the dialog that appears, fill in:
   - **Working directory** (required) — click "Browse" to select a project folder, or type a path
   - **Label** (optional) — a name for the session; defaults to the folder name
   - **Initial prompt** (optional) — what you want Claude to work on
   - **Permission mode** (optional) — controls how Claude handles tool permissions (`default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`)
3. Click **Create**

A new terminal tile opens in the main area and Claude Code starts in your chosen directory.

## Working with Sessions

### Interacting with a Terminal

Click inside a terminal tile to focus it, then type as you would in any terminal. Claude Code runs inside the terminal — you can send prompts, approve tool calls, and see output in real time.

### Renaming a Session

Double-click the session name in the sidebar to edit it inline. Press **Enter** to save or **Escape** to cancel.

### Closing vs. Killing a Session

- **Close** (toolbar X button) — hides the tile but the session keeps running in the background. You can reopen it later.
- **Kill** (toolbar Kill button or sidebar X on hover) — terminates the Claude Code process. The session moves to "Ended" status.

### Reopening a Closed Session

Hover over the session in the sidebar and click the **+** button to reopen its tile in the layout.

## Tiling Layout

mcode uses a tiling window manager so you can view multiple sessions side by side.

- **Resize tiles** — drag the dividers between tiles
- **Rearrange tiles** — drag tiles to reorder them in the layout
- Your layout is automatically saved and restored on next launch

## Tips

- Run multiple sessions in parallel to work on different tasks or different repos at the same time
- Use descriptive labels so you can quickly identify each session in the sidebar
- Close tiles you don't need to watch — the session continues running in the background
- Use the `plan` permission mode when you want Claude to propose changes before making them
