export interface ProviderErrorOptions {
  providerId: string;
  message: string;
  status?: number;
  code?: string;
  retryable?: boolean;
  responseBody?: string;
}

export class ProviderError extends Error {
  readonly providerId: string;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryable: boolean;
  readonly responseBody: string | undefined;

  constructor(options: ProviderErrorOptions) {
    super(options.message);
    this.name = "ProviderError";
    this.providerId = options.providerId;
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.responseBody = options.responseBody;
  }
}

export function sanitizeProviderBody(body: string, maxLength = 1200): string {
  const compact = body
    .replace(/\s+/g, " ")
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret)["']?\s*:\s*)["'][^"']*["']/gi,
      "$1\"[REDACTED]\"",
    )
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret)["']?\s*=\s*)["']?[^"',}\s]+["']?/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(https?:\/\/)[^@\s/?#]+@/gi, "$1[REDACTED]@")
    .replace(
      /([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(sk-[a-z0-9_-]{8,})\b/gi, "[REDACTED]")
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}
