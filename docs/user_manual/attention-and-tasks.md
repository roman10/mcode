# Attention & Tasks

## Attention System

When a session needs your input — for example, a permission request or a completed turn — mcode raises its attention level so you notice it even when focused on another tile.

### Attention levels

| Level | Sidebar indicator | Meaning |
|---|---|---|
| Action | Red left border, pulsing ring | Immediate action needed (e.g., permission request) |
| Info | Amber left border | Session completed a turn or sent a notification |
| None | No border | Nothing to act on |

### Other visual cues

- **Tile toolbar** — a red inset glow appears on the toolbar when a session has action-level attention
- **Dock badge** — the app icon shows a badge count of action-level attention sessions
- **System notification** — a macOS notification is sent for action-level attention when the app is not focused

### Clearing attention

- Click the **Mark all read** button (bell-off icon) in the sidebar header to clear all sessions at once, or press `Cmd+Shift+M`
- Attention on an individual session clears automatically when you interact with its tile

## Task Queue

The task queue lets you schedule prompts to be dispatched to sessions. Tasks are created via the New Task dialog (`Cmd+Shift+T`) and appear in the task panel at the top of each session's terminal tile.

### Creating a task

Press `Cmd+Shift+T` to open the New Task dialog. Fill in:

- **Prompt** — the instruction to send
- **Working directory** — the project folder for the task
- **Target session** — pick an existing active or idle session (required)

### Task statuses

| Status | Color | Meaning |
|---|---|---|
| Queued | Amber | Waiting to be dispatched |
| Running | Green | Currently being executed |
| Done | Blue | Completed successfully |
| Failed | Red | Failed (hover the dot for the error) |

### Task panel in tiles

When a session has pending or in-progress tasks, a collapsible **Tasks** bar appears at the top of its terminal tile (just below the toolbar). It shows how many tasks are queued, and expands to list them with their status:

- **Amber dot** — Queued (waiting to be dispatched)
- **Green dot** — Running (currently being dispatched)

For queued tasks you can hover to reveal:
- **Up/down arrows** — reorder the task within the queue
- **Pencil icon** — edit the task prompt inline; `Cmd+Enter` to save, `Escape` to cancel
- **× icon** — cancel the task

Click the Tasks bar header to collapse or expand the panel.
