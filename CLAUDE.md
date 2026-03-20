# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mcode** is a desktop IDE for managing multiple autonomous Claude Code sessions simultaneously. It's MacOS first, but with plans to extend to other OS in the future. 

The core hypothesis is that multi-tasking is essential part of the SWE flow in the agentic coding era, and the IDE shall 
facilitate a SWE to work with a large number of agents efficiently and easily, while maintaining a good sense of control
and be able to get into the flow.

## Status

Not released yet. Skip backward compatibility when we can and aim for clean code.

## Principles

- For every new feature, it shall be exposed to coding agent like Claude Code such that it can be verified automatically. Use composition of existing capabilities when 
possible, otherwise build new capabilities which can be combined with existing capabilities to automate the feature verification.
- When testing using MCP / APIs, start a new dev instance with "npm run dev", don't use the current running production version to avoid polluting the production version database.

## Tech Stack

- **App shell:** Electron 41.x + electron-vite
- **Frontend:** React 19 + TypeScript 5.9+
- **Terminal:** node-pty (spawning) + xterm.js with WebGL addon (rendering)
- **Tiling layout:** react-mosaic-component
- **State management:** Zustand
- **Database:** better-sqlite3 (SQLite, WAL mode)
- **Styling:** Tailwind CSS v4 (CSS-based config, no tailwind.config.ts)
- **Packaging:** electron-builder

## Conventions

- One React component per file, PascalCase filenames matching component name
- Zustand store files suffixed `-store.ts`
- Shared types in `src/shared/types.ts`, constants in `src/shared/constants.ts`
- Database tables: plural snake_case (`sessions`, `task_queue`, `layout_state`)
- SQLite migrations in numbered SQL files (`db/migrations/001_initial.sql`, etc.)
- Tailwind v4: use `@theme` directives in `global.css` for design tokens, not a JS config file
- Terminal font: JetBrains Mono 13px, ligatures disabled; UI font: Inter or system, 13px
