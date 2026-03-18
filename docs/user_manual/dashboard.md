# Dashboard

mcode includes two dashboard tiles that can be toggled on and off from the sidebar footer.

## Activity Feed

The activity feed shows a live stream of events from all sessions — tool calls, session starts/ends, permission requests, and more.

**Open it:** Click the activity icon in the sidebar footer, or press `Cmd+Shift+A`.

### Event types

| Event | Description |
|---|---|
| SessionStart | A session was created |
| SessionEnd | A session ended |
| PreToolUse | Claude is about to use a tool |
| PostToolUse | A tool call completed |
| PostToolUseFailure | A tool call failed |
| Stop | Claude finished its turn |
| PermissionRequest | Claude is waiting for tool approval |
| Notification | A notification from Claude |

### Filters

Use the dropdowns at the top of the feed to filter by:

- **Session** — show events from a specific session only
- **Event type** — show only a particular event type (e.g., just PermissionRequest)

Click **Clear** to reset filters.

## Commit Tracking

The commit stats tile shows your commit activity for the day across all repos that have active sessions.

**Open it:** Click the git icon in the sidebar footer.

### What it shows

- **Total commits today** with lines changed (insertions + deletions)
- **Streak** — consecutive days with at least one commit
- **Claude vs solo** — how many commits were Claude-assisted
- **7-day heatmap** — color intensity shows commit volume per day
- **Commits by type** — breakdown by conventional commit prefix (feat, fix, refactor, docs, test, chore)
- **Per-repo breakdown** — commit count and line changes per repository
- **Cadence** — average minutes between commits and peak commit hour
- **Weekly trend** — this week's count vs last week with percentage change

### Settings

By default only commits on the main branch are tracked. To include all branches, toggle **Scan all branches** in [Settings](settings.md).
