# mcode

A desktop IDE for managing multiple autonomous Claude Code sessions simultaneously.

## Core Idea

- **Tiling terminal manager** — each tile runs a fully interactive Claude Code session via `node-pty` + `xterm.js`
- **Control panel** — aggregates real-time status from all sessions and highlights those requiring human attention
- **Task queue** — queue prompts to existing or new sessions, with scheduling support
- **Hook-driven monitoring** — receives Claude Code hook events (tool use, notifications, stops) over HTTP for live session visibility
- **Agent-extensible** — Claude Code first, with a generic interface for other agents

## Tech Stack

Electron + React/TypeScript, using the same terminal stack as VS Code and Cursor (`node-pty` + `xterm.js`), with `react-mosaic` for tiling layout, `zustand` for state, and `better-sqlite3` for persistence.
