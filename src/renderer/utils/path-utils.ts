export function basename(p: string): string {
  const trimmed = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf('/');
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

export function normalizeCwd(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
