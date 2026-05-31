export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  // Handle future timestamps (e.g. an expiry) — not just past — so a future
  // date doesn't collapse to "just now".
  const diffMs = now - then;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const seconds = Math.floor(abs / 1000);
  if (seconds < 60) return 'just now';

  const suffix = (n: number, unit: string) =>
    future ? `in ${n} ${unit}${n === 1 ? '' : 's'}` : `${n} ${unit}${n === 1 ? '' : 's'} ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return suffix(minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return suffix(hours, 'hour');

  const days = Math.floor(hours / 24);
  return suffix(days, 'day');
}
