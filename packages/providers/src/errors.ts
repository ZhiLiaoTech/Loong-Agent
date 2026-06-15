import { redactSecretsInText } from "@loong/security";

export interface ProviderErrorOptions {
  providerId: string;
  message: string;
  status?: number;
  code?: string;
  retryable?: boolean;
  responseBody?: string;
  attempts?: number;
  causeName?: string;
  causeCode?: string;
  causeMessage?: string;
}

export class ProviderError extends Error {
  readonly providerId: string;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryable: boolean;
  readonly responseBody: string | undefined;
  readonly attempts: number | undefined;
  readonly causeName: string | undefined;
  readonly causeCode: string | undefined;
  readonly causeMessage: string | undefined;

  constructor(options: ProviderErrorOptions) {
    super(options.message);
    this.name = "ProviderError";
    this.providerId = options.providerId;
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.responseBody = options.responseBody;
    this.attempts = options.attempts;
    this.causeName = options.causeName;
    this.causeCode = options.causeCode;
    this.causeMessage = options.causeMessage;
  }
}

export function sanitizeProviderBody(body: string, maxLength = 1200): string {
  return redactSecretsInText(body, { maxLength, compactWhitespace: true });
}

export function providerNetworkErrorDetails(error: unknown): Pick<
  ProviderErrorOptions,
  "responseBody" | "causeName" | "causeCode" | "causeMessage"
> {
  const details: Pick<ProviderErrorOptions, "responseBody" | "causeName" | "causeCode" | "causeMessage"> = {};
  if (error instanceof Error) {
    details.responseBody = sanitizeProviderBody(error.message);
    const cause = readErrorCause(error);
    const causeName = readErrorName(cause);
    const causeCode = readErrorCode(cause);
    const causeMessage = readErrorMessage(cause);
    if (causeName !== undefined) {
      details.causeName = sanitizeProviderBody(causeName, 200);
    }
    if (causeCode !== undefined) {
      details.causeCode = sanitizeProviderBody(causeCode, 200);
    }
    if (causeMessage !== undefined) {
      details.causeMessage = sanitizeProviderBody(causeMessage);
    }
  } else if (error !== undefined) {
    details.responseBody = sanitizeProviderBody(String(error));
  }
  return details;
}

function readErrorCause(error: Error): unknown {
  return "cause" in error
    ? (error as { cause?: unknown }).cause
    : undefined;
}

function readErrorName(value: unknown): string | undefined {
  if (value instanceof Error && value.name) {
    return value.name;
  }
  if (isRecord(value)) {
    return readString(value.name);
  }
  return undefined;
}

function readErrorCode(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const code = value.code;
  return typeof code === "string" || typeof code === "number"
    ? String(code)
    : undefined;
}

function readErrorMessage(value: unknown): string | undefined {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (isRecord(value)) {
    return readString(value.message);
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
