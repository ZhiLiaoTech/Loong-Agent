import { randomUUID } from "node:crypto";
import type { DragonEvent } from "@dragon/core";
export interface SessionCoordinatorAgentParams {
  sessionId: string;
  message: string;
}

export interface AgentTurnResultPayload {
  result: unknown;
  events: DragonEvent[];
}

export interface AgentTurnQueuedPayload {
  queued: true;
  queueTurnId: string;
  sessionId: string;
  position: number;
}

export type AgentTurnResponse = AgentTurnResultPayload | AgentTurnQueuedPayload;

export function isAgentTurnQueuedPayload(
  response: AgentTurnResponse,
): response is AgentTurnQueuedPayload {
  return "queued" in response && response.queued === true;
}

interface QueueEntry<TParams extends SessionCoordinatorAgentParams = SessionCoordinatorAgentParams> {
  queueTurnId: string;
  sessionId: string;
  params: TParams;
  enqueuedAt: string;
  position: number;
  resolve: (payload: AgentTurnResultPayload) => void;
  reject: (error: unknown) => void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Per-session turn queue: one active runTurn at a time; additional agent RPCs
 * return queued metadata and complete via agent.wait.
 */
export class SessionTurnCoordinator {
  readonly #queues = new Map<string, QueueEntry<SessionCoordinatorAgentParams>[]>();
  readonly #waiters = new Map<string, Deferred<AgentTurnResultPayload>>();
  readonly #activeSessions = new Set<string>();

  getQueueDepth(sessionId: string): number {
    return this.#queues.get(sessionId)?.length ?? 0;
  }

  isSessionActive(sessionId: string): boolean {
    return this.#activeSessions.has(sessionId);
  }

  async runOrEnqueue<TParams extends SessionCoordinatorAgentParams>(
    sessionId: string,
    params: TParams,
    runner: (params: TParams) => Promise<AgentTurnResultPayload>,
  ): Promise<AgentTurnResponse> {
    if (this.#activeSessions.has(sessionId)) {
      return this.#enqueue(sessionId, params);
    }
    const payload = await this.#runExclusive(sessionId, params, runner);
    return payload;
  }

  async waitForQueuedTurn(queueTurnId: string, timeoutMs = 600_000): Promise<AgentTurnResultPayload> {
    const waiter = this.#waiters.get(queueTurnId);
    if (!waiter) {
      throw new Error(`Unknown or expired queueTurnId: ${queueTurnId}`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for queueTurnId ${queueTurnId}.`)), timeoutMs);
    });
    try {
      return await Promise.race([waiter.promise, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async #enqueue<TParams extends SessionCoordinatorAgentParams>(
    sessionId: string,
    params: TParams,
  ): Promise<AgentTurnQueuedPayload> {
    const queueTurnId = randomUUID();
    const queue = this.#queues.get(sessionId) ?? [];
    const deferred = createDeferred<AgentTurnResultPayload>();
    const entry: QueueEntry = {
      queueTurnId,
      sessionId,
      params,
      enqueuedAt: new Date().toISOString(),
      position: queue.length + 1,
      resolve: deferred.resolve,
      reject: deferred.reject,
    };
    queue.push(entry);
    this.#queues.set(sessionId, queue);
    this.#waiters.set(queueTurnId, deferred);
    return {
      queued: true,
      queueTurnId,
      sessionId,
      position: entry.position,
    };
  }

  async #runExclusive<TParams extends SessionCoordinatorAgentParams>(
    sessionId: string,
    params: TParams,
    runner: (params: TParams) => Promise<AgentTurnResultPayload>,
  ): Promise<AgentTurnResultPayload> {
    this.#activeSessions.add(sessionId);
    try {
      return await runner(params);
    } finally {
      this.#activeSessions.delete(sessionId);
      void this.#drain(sessionId, runner);
    }
  }

  async #drain<TParams extends SessionCoordinatorAgentParams>(
    sessionId: string,
    runner: (params: TParams) => Promise<AgentTurnResultPayload>,
  ): Promise<void> {
    const queue = this.#queues.get(sessionId);
    if (!queue || queue.length === 0) {
      return;
    }
    while (queue.length > 0) {
      const entry = queue.shift()!;
      this.#activeSessions.add(sessionId);
      try {
        const payload = await runner(entry.params as TParams);
        entry.resolve(payload);
        this.#waiters.get(entry.queueTurnId)?.resolve(payload);
        this.#waiters.delete(entry.queueTurnId);
      } catch (error) {
        entry.reject(error);
        this.#waiters.get(entry.queueTurnId)?.reject(error);
        this.#waiters.delete(entry.queueTurnId);
      } finally {
        this.#activeSessions.delete(sessionId);
      }
    }
    if (queue.length === 0) {
      this.#queues.delete(sessionId);
    }
  }
}
