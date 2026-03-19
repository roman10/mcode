const isMac = window.mcode.app.getPlatform() === 'darwin';
const modLabel = isMac ? '⌘' : 'Ctrl+';

export function formatKeys(keys: string, mod: boolean): string {
  const display = keys
    .replace('Shift+', isMac ? '⇧' : 'Shift+')
    .replace('Enter', isMac ? '↵' : 'Enter')
    .replace('Escape', 'Esc');
  return mod ? `${modLabel}${display}` : display;
}
