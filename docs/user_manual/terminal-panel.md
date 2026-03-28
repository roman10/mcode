# Terminal Panel

The **Terminal Panel** is a persistent terminal area at the bottom of the mcode window. It provides a quick way to run plain terminal commands alongside your agent sessions without occupying a tile in the main layout.

## Toggling the Panel

Press `Ctrl+` ` (backtick) to show or hide the terminal panel. The panel state and its terminals are persisted across app restarts.

## Resizing

The panel can be resized by dragging the thin border at the top of the panel. mcode remembers your preferred height.

## Managing Terminals

The terminal panel supports multiple terminals organized in tabs.

- **New Terminal**: Click the **+** button in the panel toolbar or press `Cmd+T` (when the panel is focused).
- **Close Terminal**: Click the **X** on the tab or press `Cmd+Shift+W`.
- **Rename Tab**: Double-click a tab label to rename it.

## Layout & Splits

You can split terminals within the panel to see multiple outputs at once:

- **Split Horizontal**: Press `Cmd+D`.
- **Split Vertical**: Press `Cmd+Shift+D`.

To focus a different split, simply click inside it.

## Keyboard Shortcuts

The following shortcuts are available when the terminal panel is focused:

| Shortcut | Action |
|---|---|
| `Ctrl+Backtick` | Toggle terminal panel |
| `Cmd+D` | Split horizontal |
| `Cmd+Shift+D` | Split vertical |
| `Cmd+]` | Next terminal tab |
| `Cmd+[` | Previous terminal tab |
| `Cmd+Shift+W` | Kill session & close terminal |
| `F2` | Rename terminal tab |
