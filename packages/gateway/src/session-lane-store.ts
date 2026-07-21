export interface SessionLaneStore {
  runInLane<T>(sessionId: string, task: () => Promise<T>): Promise<T>;
}

export type SessionLaneMode = "memory" | "stateless";

/**
 * Serializes async work per sessionId inside a single gateway process.
 */
export class InMemorySessionLaneStore implements SessionLaneStore {
  readonly #lanes = new Map<string, Promise<void>>();

  async runInLane<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#lanes.get(sessionId) ?? Promise.resolve();
    let releaseCurrent: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);
    this.#lanes.set(sessionId, next);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.#lanes.get(sessionId) === next) {
        this.#lanes.delete(sessionId);
      }
    }
  }
}

/**
 * No per-session serialization — suitable when orchestration owns concurrency.
 */
export class StatelessSessionLaneStore implements SessionLaneStore {
  async runInLane<T>(_sessionId: string, task: () => Promise<T>): Promise<T> {
    return await task();
  }
}

export function normalizeSessionLaneMode(value: string | undefined): SessionLaneMode {
  const mode = String(value || "memory").trim().toLowerCase();
  return mode === "stateless" ? "stateless" : "memory";
}

export function createSessionLaneStore(mode: SessionLaneMode = "memory"): SessionLaneStore {
  return mode === "stateless"
    ? new StatelessSessionLaneStore()
    : new InMemorySessionLaneStore();
}

export function createSessionLaneStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionLaneStore {
  return createSessionLaneStore(normalizeSessionLaneMode(env.LOONG_SESSION_LANE_MODE));
}
