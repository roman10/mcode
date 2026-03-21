# Sidebar Panels

The sidebar header has five tabs: **Sessions**, **Commits**, **Changes**, **Tokens**, and **Activity**. Click the tab icons to switch, or use the keyboard shortcuts below.

## Activity Feed

**Open it:** Click the Activity tab in the sidebar header, or press `Cmd+Shift+A`.

A live stream of hook events from all sessions — tool calls, session lifecycle, permission requests, and more.

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

## Changes

**Open it:** Click the Changes tab in the sidebar header, or press `Cmd+Shift+C`.

Shows git changes and commit history for repos with active sessions. The tab badge counts unstaged + staged files across all tracked repos.

### Git Changes

Staged and unstaged files for each tracked repo, with per-file and bulk operations. See [Git Changes](git-changes.md) for full details.

### Commit Graph

A visual commit graph for each tracked repo, showing branch topology:

- Each repo is shown as a collapsible section labelled by repo name with a commit count
- Commits are listed newest-first with branch/merge lane lines on the left
- Click **Show more** at the bottom of a section to load older commits
- Click the **refresh** button in the Commits header to reload

## Commit Tracking

**Open it:** Click the Commits tab in the sidebar header, or press `Cmd+Shift+B`.

Shows your commit activity for the day across all repos that have active sessions.

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

## Token Usage

**Open it:** Click the Tokens tab in the sidebar header, or press `Cmd+Shift+U`.

Shows token consumption and estimated cost across all sessions.

### What it shows

- **Headline stats** — estimated cost for the selected day, message count, cost per message
- **Token breakdown** — input tokens, output tokens, total tokens
- **7-day heatmap** — green shading shows cost per day; click a cell to view that day's data
- **Model breakdown** — pills for each model used (purple for Opus, blue for Sonnet, green for Haiku) with cost and percentage
- **Cache efficiency** — cache hit rate percentage (shown when cache reads exist)
- **Top sessions** — the sessions with the highest token usage for the selected day
- **Weekly trend** — this week's cost vs last week, with percentage change

### Navigation

- Use the **left/right arrows** or click heatmap cells to navigate between days
- Click **Today** to return to the current day
- Press `Cmd+R` to refresh token data manually
- Data is retained for 90 days
