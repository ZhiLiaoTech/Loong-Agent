import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { LoongChannelGatewayOptions, LoongChannelMessage } from "./index.js";

type ChannelApi = typeof import("./index.js");
let channelApiPromise: Promise<ChannelApi> | undefined;

function loadChannelApi(): Promise<ChannelApi> {
  channelApiPromise ??= import("./index.js");
  return channelApiPromise;
}

export interface GatewayBridgeServerOptions {
  host?: string;
  port?: number;
  gatewayUrl: string;
  sharedSecret?: string;
  defaults?: LoongChannelGatewayOptions;
  fetchImpl?: typeof fetch;
}

export interface GatewayBridgeServerHandle {
  url: string;
  stop(): Promise<void>;
}

export async function startGatewayBridgeServer(
  options: GatewayBridgeServerOptions,
): Promise<GatewayBridgeServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 17_358;
  const handler = createGatewayBridgeHandler(options);
  const server = createServer((request, response) => {
    handler(request, response).catch(error => {
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Gateway bridge failed to resolve listening address.");
  }

  const url = `http://${host}:${address.port}`;
  return {
    url,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

export function createGatewayBridgeHandler(options: GatewayBridgeServerOptions) {
  const gatewayUrl = options.gatewayUrl.replace(/\/+$/, "");
  const defaults = options.defaults;

  return async function handleBridgeRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    if (method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true, service: "loong-channels-bridge" });
      return;
    }
    if (method !== "POST") {
      writeJson(response, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const body = await readRequestBody(request);
    let parsed: unknown;
    try {
      parsed = body.trim() ? JSON.parse(body) : {};
    } catch {
      writeJson(response, 400, { ok: false, error: "Request body must be JSON." });
      return;
    }

    const api = await loadChannelApi();
    let message: LoongChannelMessage | undefined;
    if (url.pathname === "/telegram" || url.pathname === "/webhook/telegram") {
      message = api.parseTelegramWebhook(parsed);
    } else if (url.pathname === "/slack" || url.pathname === "/webhook/slack") {
      message = api.parseSlackWebhook(parsed);
    } else if (url.pathname === "/channels/webhook" || url.pathname === "/webhook") {
      message = parseGenericWebhookPayload(parsed);
    } else {
      writeJson(response, 404, { ok: false, error: `Unknown path: ${url.pathname}` });
      return;
    }

    if (message === undefined) {
      writeJson(response, 200, { ok: true, skipped: true, reason: "no_message" });
      return;
    }

    const payload = api.toGatewayWebhookPayload(message, defaults ?? {});
    const result = await api.postGatewayWebhook({
      gatewayUrl,
      body: payload,
      ...(options.sharedSecret !== undefined ? { sharedSecret: options.sharedSecret } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    writeJson(response, result.ok ? 200 : result.status || 502, {
      ok: result.ok,
      channel: message.channel,
      ...(result.payload !== undefined ? { payload: result.payload } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
  };
}

function parseGenericWebhookPayload(parsed: unknown): LoongChannelMessage | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Webhook payload must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.message !== "string" || !record.message.trim()) {
    return undefined;
  }
  const channel = typeof record.channel === "string" && record.channel.trim()
    ? record.channel.trim()
    : "webhook";
  return {
    channel,
    text: record.message.trim(),
    ...(typeof record.userId === "string" ? { userId: record.userId } : {}),
    ...(typeof record.threadId === "string" ? { threadId: record.threadId } : {}),
    ...(isRecord(record.metadata) ? { metadata: record.metadata } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(payload);
}
