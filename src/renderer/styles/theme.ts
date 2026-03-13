import type { ITheme } from '@xterm/xterm';

export const theme = {
  bg: {
    primary: '#0d1117',
    secondary: '#161b22',
    elevated: '#1c2128',
    terminal: '#000000',
  },
  border: {
    default: '#30363d',
    focus: '#58a6ff',
  },
  text: {
    primary: '#e6edf3',
    secondary: '#8b949e',
    muted: '#484f58',
  },
  accent: '#58a6ff',
};

export const darkTheme: ITheme = {
  background: theme.bg.terminal,
  foreground: theme.text.primary,
  cursor: theme.accent,
  cursorAccent: theme.bg.terminal,
  selectionBackground: '#264f78',
  selectionForeground: '#e6edf3',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};
