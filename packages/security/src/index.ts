export interface RedactSecretsInTextOptions {
  maxLength?: number;
  compactWhitespace?: boolean;
  replacement?: string;
}

export const DEFAULT_REDACTION = "[REDACTED]";

const DEFAULT_MAX_TEXT_LENGTH = 1200;
const SENSITIVE_KEY_PATTERN = /token|secret|api[_-]?key|authorization|password|credential|access[_-]?token|refresh[_-]?token|id[_-]?token|(^|[_-])key($|[_-])/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactSecretsInText(value: string, options: RedactSecretsInTextOptions = {}): string {
  const replacement = options.replacement ?? DEFAULT_REDACTION;
  const maxLength = normalizeMaxLength(options.maxLength ?? DEFAULT_MAX_TEXT_LENGTH);
  const source = options.compactWhitespace === true ? value.replace(/\s+/g, " ") : value;
  const redacted = source
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|credential)["']?\s*:\s*)["'][^"']*["']/gi,
      `$1"${replacement}"`,
    )
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|credential)["']?\s*=\s*)["']?(?:bearer\s+)?[^"',}\s]+["']?/gi,
      `$1${replacement}`,
    )
    .replace(/\b(https?:\/\/)[^@\s/?#]+@/gi, `$1${replacement}@`)
    .replace(
      /([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password)=)[^&#\s]+/gi,
      `$1${replacement}`,
    )
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, `$1${replacement}`)
    .replace(/\b(sk-[a-z0-9_-]{8,})\b/gi, replacement)
    .trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}

export function redactSensitiveJsonValue(key: string, value: unknown, replacement = DEFAULT_REDACTION): unknown {
  return isSensitiveKey(key) ? replacement : value;
}

function normalizeMaxLength(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_MAX_TEXT_LENGTH;
  }
  return value;
}
