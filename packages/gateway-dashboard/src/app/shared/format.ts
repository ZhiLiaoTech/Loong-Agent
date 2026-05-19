export function shortId(value: string): string {
  return value ? String(value).slice(0, 8) : "";
}

export function formatTime(value: string | undefined): string {
  return value ? new Date(value).toLocaleTimeString() : "";
}

export function formatDateTime(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : "";
}

export function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h`;
}
