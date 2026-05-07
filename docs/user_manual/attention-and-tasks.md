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

Press `Cmd+Shift+T` to open the New Task dialog. When at least one Claude session is open and live, the dialog shows a **New prompt / Plan Mode response** toggle at the top — see [Plan Mode Response](#plan-mode-response) below. For a regular prompt task, fill in:

- **Prompt** — the instruction to send
- **Working directory** — the project folder for the task
- **Target session** — pick an existing active or idle session (required)
- **Permission mode** (optional) — change the target session's permission mode when this task is dispatched; disabled until a target session is selected; defaults to "Don't change". Available modes depend on the target session's agent type.

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
- **Pencil icon** — open the Edit Task dialog; `Cmd+Enter` to save, `Escape` to cancel
- **× icon** — cancel the task

Click the Tasks bar header to collapse or expand the panel.

## Plan Mode Response

When a Claude session finishes plan mode and is waiting for you to accept, modify, or reject the plan, you can queue your response as a task instead of typing it directly into the terminal. This is useful when juggling many sessions — you queue the response and move on, and mcode dispatches it the moment that session is ready.

**Open the Plan Mode Response dialog** with `Cmd+Shift+R`, or open the regular New Task dialog (`Cmd+Shift+T`) and switch to the **Plan Mode response** tab at the top. The tab only appears when at least one open Claude session can receive a plan response.

### Choose one of three actions

| Option | Effect |
|---|---|
| **Yes, auto-accept edits** | Approves the plan and lets Claude apply edits without further prompts |
| **Yes, manually approve edits** | Approves the plan but leaves Claude in a mode that asks before each edit |
| **Tell Claude what to change** | Sends a revise instruction. A prompt field appears so you can describe what to change. |

Plan-response tasks are dispatched the same way as normal tasks — they queue against the target Claude session and run when it's ready. The working directory is locked to the target session's cwd, and the permission mode is inherited from the target session (the field is hidden in this mode).
