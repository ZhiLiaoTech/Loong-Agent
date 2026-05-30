import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { LoongEvent } from "@loong/core";
import { readSingleHeader, writeSse } from "./gateway-http.js";
import {
  matchesEventFilters,
  parseEventStreamFilters,
  type EventStreamFilters,
  type GatewayEventEnvelope,
} from "./gateway-event-stream.js";
import { parseGatewayRequest } from "./gateway-rpc-parse.js";
import type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";
import {
  closeWebSocketClient,
  isValidWebSocketUpgrade,
  MAX_WEBSOCKET_BUFFER_BYTES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  parseWebSocketFrames,
  readWebSocketProtocols,
  rejectWebSocketUpgrade,
  sendWebSocketFrame,
  sendWebSocketJson,
  WEBSOCKET_GUID,
  WEBSOCKET_PROTOCOL,
  type WebSocketClient,
} from "./gateway-websocket.js";

interface EventStreamClient {
  id: string;
  response: ServerResponse;
  filters: EventStreamFilters;
  heartbeat: NodeJS.Timeout;
}

export interface GatewayConnectionHubDeps {
  isAuthorized(request: IncomingMessage): boolean;
  tryConsumeWebSocket(request: IncomingMessage): boolean;
  handleRpc(request: GatewayRequest): Promise<GatewayResponse>;
  resolveSessionId(event: LoongEvent): string | undefined;
}

export class GatewayConnectionHub {
  readonly #deps: GatewayConnectionHubDeps;
  readonly #eventClients = new Map<string, EventStreamClient>();
  readonly #webSocketClients = new Map<string, WebSocketClient>();
  #eventSequence = 0;

  constructor(deps: GatewayConnectionHubDeps) {
    this.#deps = deps;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://loong.local");
    if (url.pathname !== "/ws") {
      rejectWebSocketUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!this.#deps.tryConsumeWebSocket(request)) {
      rejectWebSocketUpgrade(socket, 429, "Too Many Requests");
      return;
    }
    if (!this.#deps.isAuthorized(request)) {
      rejectWebSocketUpgrade(socket, 401, "Unauthorized");
      return;
    }
    const key = readSingleHeader(request, "sec-websocket-key");
    if (!isValidWebSocketUpgrade(request, key)) {
      rejectWebSocketUpgrade(socket, 400, "Bad Request");
      return;
    }

    const protocols = readWebSocketProtocols(request);
    const selectedProtocol = protocols.includes(WEBSOCKET_PROTOCOL) ? WEBSOCKET_PROTOCOL : undefined;
    const accept = createHash("sha1")
      .update(`${key}${WEBSOCKET_GUID}`)
      .digest("base64");
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      ...(selectedProtocol ? [`Sec-WebSocket-Protocol: ${selectedProtocol}`] : []),
      "",
      "",
    ];
    socket.write(responseHeaders.join("\r\n"));

    const clientId = randomUUID();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      filters: parseEventStreamFilters(url),
      heartbeat: setInterval(() => {
        if (!client.closed) {
          sendWebSocketFrame(client, 0x9, Buffer.alloc(0));
        }
      }, 15_000),
      buffer: Buffer.alloc(0),
      closed: false,
    };
    this.#webSocketClients.set(clientId, client);
    sendWebSocketJson(client, {
      type: "ready",
      clientId,
      filters: client.filters,
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
    });

    socket.on("data", chunk => {
      this.handleWebSocketData(client, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    socket.on("close", () => {
      this.removeWebSocketClient(client.id);
    });
    socket.on("error", () => {
      this.removeWebSocketClient(client.id);
    });
    if (head.length > 0) {
      this.handleWebSocketData(client, head);
    }
  }

  handleWebSocketData(client: WebSocketClient, chunk: Buffer): void {
    if (client.closed) {
      return;
    }
    client.buffer = Buffer.concat([client.buffer, chunk]);
    if (client.buffer.byteLength > MAX_WEBSOCKET_BUFFER_BYTES) {
      closeWebSocketClient(client, 1009, "WebSocket buffer limit exceeded.");
      this.removeWebSocketClient(client.id);
      return;
    }

    let parsed;
    try {
      parsed = parseWebSocketFrames(client.buffer);
    } catch (error) {
      closeWebSocketClient(client, 1002, error instanceof Error ? error.message : String(error));
      this.removeWebSocketClient(client.id);
      return;
    }
    client.buffer = parsed.remaining;

    for (const frame of parsed.frames) {
      if (frame.opcode === 0x8) {
        closeWebSocketClient(client, 1000, "Normal closure.");
        this.removeWebSocketClient(client.id);
        return;
      }
      if (frame.opcode === 0x9) {
        sendWebSocketFrame(client, 0xA, frame.payload);
        continue;
      }
      if (frame.opcode === 0xA) {
        continue;
      }
      if (frame.opcode === 0x1) {
        this.handleWebSocketText(client, frame.payload.toString("utf8")).catch(error => {
          sendWebSocketJson(client, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }
      closeWebSocketClient(client, 1003, "Unsupported WebSocket frame.");
      this.removeWebSocketClient(client.id);
      return;
    }
  }

  async handleWebSocketText(client: WebSocketClient, text: string): Promise<void> {
    let request: GatewayRequest;
    try {
      request = parseGatewayRequest(JSON.parse(text) as unknown);
    } catch (error) {
      sendWebSocketJson(client, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const response = await this.#deps.handleRpc(request);
    if (!sendWebSocketJson(client, response)) {
      sendWebSocketJson(client, {
        type: "response",
        id: request.id,
        ok: false,
        error: `WebSocket response exceeds ${MAX_WEBSOCKET_MESSAGE_BYTES} bytes.`,
      });
    }
  }

  openEventStream(request: IncomingMessage, response: ServerResponse, url: URL): void {
    const filters = parseEventStreamFilters(url);
    const clientId = randomUUID();
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");
    writeSse(response, "ready", {
      type: "ready",
      clientId,
      filters,
      serverTime: new Date().toISOString(),
    });

    const heartbeat = setInterval(() => {
      if (!response.destroyed) {
        response.write(": heartbeat\n\n");
      }
    }, 15_000);

    const client: EventStreamClient = {
      id: clientId,
      response,
      filters,
      heartbeat,
    };
    this.#eventClients.set(clientId, client);

    request.on("close", () => {
      this.removeEventStreamClient(clientId);
    });
  }

  broadcastRuntimeEvent(event: LoongEvent): void {
    if (this.#eventClients.size === 0 && this.#webSocketClients.size === 0) {
      return;
    }
    const sessionId = this.#deps.resolveSessionId(event);
    const envelope: GatewayEventEnvelope = {
      type: "event",
      sequence: ++this.#eventSequence,
      timestamp: new Date().toISOString(),
      event,
    };
    if (sessionId !== undefined) {
      envelope.sessionId = sessionId;
    }

    for (const client of this.#eventClients.values()) {
      if (!matchesEventFilters(envelope, client.filters)) {
        continue;
      }
      try {
        writeSse(client.response, "loong.event", envelope);
      } catch {
        this.removeEventStreamClient(client.id);
      }
    }
    for (const client of this.#webSocketClients.values()) {
      if (!matchesEventFilters(envelope, client.filters)) {
        continue;
      }
      if (!sendWebSocketJson(client, envelope)) {
        sendWebSocketJson(client, {
          type: "error",
          error: `Gateway event exceeds ${MAX_WEBSOCKET_MESSAGE_BYTES} bytes and was skipped.`,
        });
      }
    }
  }

  removeEventStreamClient(clientId: string): void {
    const client = this.#eventClients.get(clientId);
    if (!client) {
      return;
    }
    clearInterval(client.heartbeat);
    this.#eventClients.delete(clientId);
  }

  closeEventStreams(): void {
    for (const client of this.#eventClients.values()) {
      clearInterval(client.heartbeat);
      if (!client.response.destroyed) {
        writeSse(client.response, "close", {
          type: "close",
          reason: "gateway_stopped",
          serverTime: new Date().toISOString(),
        });
        client.response.end();
      }
    }
    this.#eventClients.clear();
  }

  removeWebSocketClient(clientId: string): void {
    const client = this.#webSocketClients.get(clientId);
    if (!client) {
      return;
    }
    clearInterval(client.heartbeat);
    client.closed = true;
    this.#webSocketClients.delete(clientId);
  }

  closeWebSocketClients(): void {
    for (const client of this.#webSocketClients.values()) {
      clearInterval(client.heartbeat);
      closeWebSocketClient(client, 1001, "Gateway stopped.");
    }
    this.#webSocketClients.clear();
  }
}
