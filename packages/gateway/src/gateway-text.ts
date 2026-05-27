export function fitUtf8Text(value: string, maxBytes: number, suffix: string): string {
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (maxBytes <= suffixBytes) {
    return Buffer.from(suffix, "utf8").subarray(0, Math.max(0, maxBytes)).toString("utf8");
  }
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  const budget = maxBytes - suffixBytes;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${suffix}`;
}
