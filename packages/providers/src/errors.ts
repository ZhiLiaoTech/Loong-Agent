import { redactSecretsInText } from "@loong/security";

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
  return redactSecretsInText(body, { maxLength, compactWhitespace: true });
}
