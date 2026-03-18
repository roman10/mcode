import { useState, useEffect } from 'react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatShortTime(isoString: string): string {
  if (!isoString) return '';

  const then = new Date(isoString);
  if (isNaN(then.getTime())) return '';

  const hh = String(then.getHours()).padStart(2, '0');
  const mm = String(then.getMinutes()).padStart(2, '0');

  const diffSec = Math.floor((Date.now() - then.getTime()) / 1000);

  if (diffSec < 0) return `${hh}:${mm}`;
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${hh}:${mm}`;
  return `${DAY_NAMES[then.getDay()]} ${hh}:${mm}`;
}

export function useRelativeTime(
  isoString: string,
  intervalMs = 30_000,
): string {
  const [formatted, setFormatted] = useState(() =>
    formatShortTime(isoString),
  );

  useEffect(() => {
    setFormatted(formatShortTime(isoString));
    const id = setInterval(
      () => setFormatted(formatShortTime(isoString)),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [isoString, intervalMs]);

  return formatted;
}
