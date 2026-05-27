import type { DragonEvent } from "@dragon/core";

export interface EventStreamFilters {
  sessionId?: string;
  runId?: string;
}

export interface GatewayEventEnvelope {
  type: "event";
  sequence: number;
  timestamp: string;
  sessionId?: string;
  event: DragonEvent;
}

export function parseEventStreamFilters(url: URL): EventStreamFilters {
  const filters: EventStreamFilters = {};
  const sessionId = url.searchParams.get("sessionId")?.trim();
  const runId = url.searchParams.get("runId")?.trim();
  if (sessionId) {
    filters.sessionId = sessionId;
  }
  if (runId) {
    filters.runId = runId;
  }
  return filters;
}

export function matchesEventFilters(envelope: GatewayEventEnvelope, filters: EventStreamFilters): boolean {
  if (filters.runId !== undefined && envelope.event.runId !== filters.runId) {
    return false;
  }
  if (filters.sessionId !== undefined && envelope.sessionId !== filters.sessionId) {
    return false;
  }
  return true;
}

export function readEventSessionId(event: DragonEvent): string | undefined {
  if (event.type === "permission") {
    return event.payload.sessionId;
  }
  const metadataSessionId = event.type === "lifecycle" ? event.metadata?.sessionId : undefined;
  return typeof metadataSessionId === "string" ? metadataSessionId : undefined;
}
