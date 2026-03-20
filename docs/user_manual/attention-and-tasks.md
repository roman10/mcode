# Attention & Tasks

## Attention System

When a session needs your input — for example, a permission request or a completed turn — mcode raises its attention level so you notice it even when focused on another tile.

### Attention levels

| Level | Sidebar indicator | Meaning |
|---|---|---|
| High | Red left border, pulsing ring | Immediate action needed (e.g., permission request) |
| Medium | Amber left border | Session completed a turn or sent a notification |
| Low | Blue left border | Informational |
| None | No border | Nothing to act on |

### Other visual cues

- **Tile toolbar** — a red inset glow appears on the toolbar when a session has high attention
- **Dock badge** — the app icon shows a badge count of high-attention sessions
- **System notification** — a macOS notification is sent for high attention when the app is not focused

### Clearing attention

- Click the **Mark all read** button (bell-off icon) in the sidebar header to clear all sessions at once, or press `Cmd+Shift+M`
- Attention on an individual session clears automatically when you interact with its tile

## Task Queue

The task queue lets you schedule prompts to be dispatched to sessions automatically. It appears as a collapsible panel at the bottom of the sidebar.

### Creating a task

Click the **+** button in the task queue header to open the create dialog, or press `Cmd+Shift+T`. Specify:

- **Prompt** — the instruction to send
- **Target session** (optional) — pick an existing session, or leave blank to create a new one
- **Priority** and **scheduling** options

### Task statuses

| Status | Color | Meaning |
|---|---|---|
| Queued | Amber | Waiting to be dispatched |
| Running | Green | Currently being executed |
| Done | Blue | Completed successfully |
| Failed | Red | Failed (hover the dot for the error) |

Pending tasks can be cancelled by hovering and clicking **x**.

The task queue requires the hook runtime to be active. If live status is unavailable, a warning message appears.
