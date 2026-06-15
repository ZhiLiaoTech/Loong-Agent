import { ProviderError, providerNetworkErrorDetails, sanitizeProviderBody } from "./errors.js";
import type { ProviderRetryOptions } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 10_000;

export async function fetchProviderWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  requestInit: RequestInit,
  providerId: string,
  retryOptions: ProviderRetryOptions | undefined,
): Promise<Response> {
  const maxAttempts = normalizePositiveInteger(retryOptions?.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = normalizeNonNegativeInteger(retryOptions?.baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = normalizeNonNegativeInteger(retryOptions?.maxDelayMs, DEFAULT_MAX_DELAY_MS);
  const signal = requestInit.signal ?? undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await fetchImpl(url, requestInit);
      if (!shouldRetryHttpResponse(response, attempt, maxAttempts, signal)) {
        return response;
      }
      await cancelResponseBody(response);
      await waitForRetry(nextDelayMs(attempt, baseDelayMs, maxDelayMs, response.headers), signal);
    } catch (error) {
      throwIfAborted(signal, error);
      if (attempt >= maxAttempts) {
        throw toNetworkProviderError(providerId, error, attempt);
      }
      await waitForRetry(nextDelayMs(attempt, baseDelayMs, maxDelayMs), signal);
    }
  }

  throw new ProviderError({
    providerId,
    code: "network_error",
    retryable: true,
    message: `Model provider "${providerId}" request failed.`,
  });
}

function shouldRetryHttpResponse(
  response: Response,
  attempt: number,
  maxAttempts: number,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted || attempt >= maxAttempts) {
    return false;
  }
  return response.status === 429 || response.status >= 500;
}

function toNetworkProviderError(providerId: string, error: unknown, attempts: number): ProviderError {
  const errorOptions = {
    providerId,
    code: "network_error",
    retryable: true,
    attempts,
    message: `Model provider "${providerId}" request failed.`,
  };
  return new ProviderError(
    error instanceof Error
      ? { ...errorOptions, ...providerNetworkErrorDetails(error) }
      : { ...errorOptions, responseBody: sanitizeProviderBody(String(error)) },
  );
}

function nextDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  headers?: Headers,
): number {
  const retryAfterMs = headers ? parseRetryAfterMs(headers) : undefined;
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, maxDelayMs);
  }
  return Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs);
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

async function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    function done(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: the response is going to be retried, so body cleanup must
    // not mask the original retryable HTTP status.
  }
}

function throwIfAborted(signal: AbortSignal | undefined, fallback?: unknown): void {
  if (!signal?.aborted) {
    return;
  }
  throw abortReason(signal, fallback);
}

function abortReason(signal: AbortSignal | undefined, fallback?: unknown): unknown {
  return signal?.reason ?? fallback ?? new Error("Provider request was aborted.");
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0
    ? value
    : fallback;
}
