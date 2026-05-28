import type { GatewayClientConfig } from "./config.js";
import { apiUrl, buildAuthHeaders } from "./request.js";
import type { GatewayEventEnvelope, SseConnectionStatus } from "./types.js";

export interface DragonEventStreamOptions {
  onEvent: (envelope: GatewayEventEnvelope) => void;
  onStatus?: (status: SseConnectionStatus, error?: string) => void;
  reconnectMs?: number;
}

export interface DragonEventStreamHandle {
  close: () => void;
}

export function openDragonEventStream(
  config: GatewayClientConfig,
  options: DragonEventStreamOptions,
): DragonEventStreamHandle {
  const reconnectMs = options.reconnectMs ?? 2000;
  let generation = 0;
  let controller: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const clearReconnect = () => {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const scheduleReconnect = (activeGeneration: number) => {
    clearReconnect();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (generation === activeGeneration) {
        void connect(activeGeneration);
      }
    }, reconnectMs);
  };

  const connect = async (activeGeneration: number) => {
    clearReconnect();
    controller?.abort();
    controller = new AbortController();
    options.onStatus?.("connecting");

    try {
      const response = await fetch(apiUrl(config, "/events"), {
        headers: buildAuthHeaders(config.getSecret),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error("events unavailable");
      }
      options.onStatus?.("live");
      await readSseBody(response.body, options.onEvent);
      if (generation === activeGeneration) {
        options.onStatus?.("disconnected");
        scheduleReconnect(activeGeneration);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      if (generation === activeGeneration) {
        const message = error instanceof Error ? error.message : String(error);
        options.onStatus?.("error", message);
        scheduleReconnect(activeGeneration);
      }
    }
  };

  const start = () => {
    generation += 1;
    void connect(generation);
  };

  start();

  return {
    close: () => {
      generation += 1;
      clearReconnect();
      controller?.abort();
      controller = undefined;
      options.onStatus?.("disconnected");
    },
  };
}

async function readSseBody(
  body: ReadableStream<Uint8Array>,
  onEvent: (envelope: GatewayEventEnvelope) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      handleSseBlock(raw, onEvent);
    }
  }
}

function handleSseBlock(
  raw: string,
  onEvent: (envelope: GatewayEventEnvelope) => void,
): void {
  if (!raw || raw.startsWith(":")) {
    return;
  }
  const lines = raw.split(/\r?\n/);
  const name = (lines.find(line => line.startsWith("event: ")) ?? "event: message").slice(7);
  const data = lines.filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
  if (!data || name !== "dragon.event") {
    return;
  }
  try {
    const parsed = JSON.parse(data) as GatewayEventEnvelope;
    if (parsed?.type === "event" && parsed.event) {
      onEvent(parsed);
    }
  } catch {
    // ignore malformed blocks
  }
}
