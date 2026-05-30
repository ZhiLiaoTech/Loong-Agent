/** Default model HTTP timeout: 300 seconds. */
export const DEFAULT_MODEL_TIMEOUT_MS = 300_000;

export class LoongModelTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    const seconds = Math.round(timeoutMs / 1000);
    super(`Model request timed out after ${seconds}s.`);
    this.name = "LoongModelTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface ModelTurnAbortHandle {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

/**
 * Merges an optional user abort signal with a model-request timeout.
 * User cancel wins when it fires before the timeout timer.
 */
export function createModelTurnAbort(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
): ModelTurnAbortHandle {
  const controller = new AbortController();
  let didTimeout = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onUserAbort = (): void => {
    if (controller.signal.aborted || didTimeout) {
      return;
    }
    controller.abort(userSignal?.reason);
  };

  const onTimeout = (): void => {
    if (controller.signal.aborted) {
      return;
    }
    didTimeout = true;
    controller.abort(new LoongModelTimeoutError(timeoutMs));
  };

  if (timeoutMs > 0) {
    timer = setTimeout(onTimeout, timeoutMs);
  }

  if (userSignal) {
    if (userSignal.aborted) {
      onUserAbort();
    } else {
      userSignal.addEventListener("abort", onUserAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}

export function isModelTimeoutError(error: unknown): boolean {
  if (error instanceof LoongModelTimeoutError) {
    return true;
  }
  if (error instanceof Error && error.cause instanceof LoongModelTimeoutError) {
    return true;
  }
  return false;
}

export function resolveTurnFailureStatus(
  error: unknown,
  userSignal: AbortSignal | undefined,
  turnAbort: ModelTurnAbortHandle,
): "cancelled" | "timeout" | "error" {
  if (turnAbort.timedOut() || isModelTimeoutError(error)) {
    return "timeout";
  }
  const reason = turnAbort.signal.reason;
  if (reason instanceof LoongModelTimeoutError) {
    return "timeout";
  }
  if (error instanceof Error && error.name === "LoongCancelledError") {
    return "cancelled";
  }
  if (userSignal?.aborted) {
    return "cancelled";
  }
  return "error";
}
