# Git Changes & Diff Viewer

mcode shows a live view of git changes for repos with active sessions, and lets you stage, unstage, and discard changes without leaving the app.

## Where it appears

The **git changes panel** appears in two places:

- **Changes tab** — in the sidebar (`Cmd+Shift+C`), above the commit graph
- **Kanban expanded view** — in the file panel on the right side when a session is expanded (below the file tabs)

## File status labels

| Label | Color | Meaning |
|---|---|---|
| `M` | Yellow | Modified |
| `A` | Green | Added (new file, staged) |
| `D` | Red | Deleted |
| `R` | Blue | Renamed |
| `?` | Gray | Untracked |

## Staged and unstaged sections

Files are grouped into two sections:

- **Staged** — changes included in the next commit
- **Unstaged** — changes not yet staged (also includes untracked files)

Click any file row to open it in the [diff viewer](#diff-viewer).

## Per-file actions

Hover over a file row to reveal action buttons:

| Area | Button | Action |
|---|---|---|
| Unstaged | `+` | Stage the file |
| Unstaged | `↺` | Discard changes (reverts to HEAD; untracked files are deleted) |
| Staged | `−` | Unstage the file |

## Bulk operations

The section headers have buttons for bulk actions:

- **Stage all** — stages all unstaged files
- **Unstage all** — unstages all staged files
- **Discard all** — discards all unstaged changes (requires confirmation)

## Diff viewer

Clicking a file row opens it in a diff viewer tile. The diff viewer shows:

- **Left side** — original content (HEAD or unstaged)
- **Right side** — modified content
- Line-level color coding: green for additions, red for deletions

Binary files show "Binary file — diff not available" instead of a diff.

Close the diff viewer tile with `Cmd+W`.
