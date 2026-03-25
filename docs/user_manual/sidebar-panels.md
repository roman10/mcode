# Sidebar Panels

The sidebar has a vertical activity bar with five panels: **Sessions**, **Search**, **Changes**, **Stats**, and **Activity**. Click the icons in the activity bar to switch, or use the keyboard shortcuts below.

## Search in Files

**Open it:** Click the Search icon in the activity bar, or press `Cmd+Shift+F`.

Search for text across all project directories with active sessions. Results are grouped by file with line numbers and context.

## Activity Feed

**Open it:** Click the Activity icon in the activity bar, or press `Cmd+Shift+A`.

The Activity tab is hidden by default for a cleaner sidebar. Reveal it permanently via **Settings > Sidebar > Show Activity tab**, or press `Cmd+Shift+A` to open it directly without enabling it in the sidebar.

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

**Open it:** Click the Changes icon in the activity bar, or press `Cmd+Shift+C`.

Shows git changes and commit history for repos with active sessions. The tab badge counts unstaged + staged files across all tracked repos.

### Git Changes

Staged and unstaged files for each tracked repo, with per-file and bulk operations. See [Git Changes](git-changes.md) for full details.

### Commit Graph

A visual commit graph for each tracked repo, showing branch topology:

- Each repo is shown as a collapsible section labelled by repo name with a commit count
- Commits are listed newest-first with branch/merge lane lines on the left
- Click **Show more** at the bottom of a section to load older commits
- Click the **refresh** button in the Commits header to reload

## Stats

**Open it:** Click the Stats icon in the activity bar, or press `Cmd+Shift+B`.

Shows commit output, token costs, and human input metrics across all repos and sessions. The panel has three collapsible sections — click any section header to collapse or expand it. Collapse state persists across restarts.

### Output

- **Total commits today** with lines changed (insertions + deletions)
- **Streak** — consecutive days with at least one commit
- **Claude vs solo** — how many commits were Claude-assisted
- **7-day heatmap** — color intensity shows commit volume per day
- **Commits by type** — breakdown by conventional commit prefix (feat, fix, refactor, docs, test, chore)
- **Per-repo breakdown** — commit count and line changes per repository
- **Cadence** — average minutes between commits and peak commit hour
- **Weekly trend** — this week's count vs last week with percentage change

By default only commits on the main branch are tracked. To include all branches, toggle **Scan all branches** in [Settings](settings.md).

### AI Cost

- **Headline stats** — estimated cost for the selected day, message count, cost per message
- **Token breakdown** — input tokens, output tokens, total tokens
- **7-day heatmap** — green shading shows cost per day; click a cell to view that day's data
- **Model breakdown** — pills for each model used (purple for Opus, blue for Sonnet, green for Haiku) with cost and percentage
- **Cache efficiency** — cache hit rate percentage (shown when cache reads exist)
- **Top sessions** — the sessions with the highest token usage for the selected day
- **Weekly trend** — this week's cost vs last week, with percentage change
- **Usage quotas** — subscription quota utilization per account: 5-hour, 7-day, and 7-day Opus limits shown as color-coded progress bars (blue < 80%, amber 80–94%, red ≥ 95%) with time until reset

### Human Input

Tracks your own interaction activity:

- **Message count** — total messages sent, with word and character counts
- **Think time** — average time elapsed between your messages
- **Leverage ratio** — ratio of AI messages to human messages
- **Messages per commit** — how many prompts it takes per commit on average
- **Peak hour** — the hour of day with the most input activity
- **Weekly trend** — this week's message count vs last week
- **7-day heatmap** — input activity intensity per day

### Navigation

- Use the **left/right arrows** or click heatmap cells to navigate between days
- Click **Today** to return to the current day
- Press `Cmd+R` to refresh manually
- **Shift+click** the refresh button to force a full 90-day history backfill (useful if commit history appears incomplete)
- Data is retained indefinitely
