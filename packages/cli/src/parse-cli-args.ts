export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

export function parseIntervalMs(value: string): number {
  const intervalMs = Number(value);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 24 * 60 * 60 * 1000) {
    throw new Error(`Invalid interval-ms: ${value}`);
  }
  return intervalMs;
}
