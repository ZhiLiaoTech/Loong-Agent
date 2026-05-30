import type { IncomingMessage, ServerResponse } from "node:http";
import { getDashboardHtml, readDashboardAsset } from "./dashboard.js";
import {
  applyCors,
  readJsonBody,
  writeHtml,
  writeJson,
} from "./gateway-http.js";
import { parseGatewayRequest } from "./gateway-rpc-parse.js";
import type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";
import { classifyHttpRoute, clientRateLimitKey, type SlidingWindowRateLimiter } from "./rate-limit.js";

export interface GatewayHttpHandlerDeps {
  rateLimiter: SlidingWindowRateLimiter;
  isAuthorized(request: IncomingMessage): boolean;
  healthPayload(): unknown;
  openEventStream(request: IncomingMessage, response: ServerResponse, url: URL): void;
  runWebhook(body: unknown): Promise<unknown>;
  handleRpc(request: GatewayRequest): Promise<GatewayResponse>;
  dispatchChannelPluginHttp?(
    request: IncomingMessage,
    response: ServerResponse,
    options: { requireGatewayAuth: boolean },
  ): Promise<boolean>;
}

export async function handleGatewayHttpRequest(
  deps: GatewayHttpHandlerDeps,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  applyCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://loong.local");
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
    writeHtml(response, 200, getDashboardHtml());
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
    const asset = readDashboardAsset(url.pathname.slice(1));
    if (asset) {
      response.writeHead(200, {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=3600",
      });
      response.end(asset.body);
      return;
    }
    writeJson(response, 404, { ok: false, error: "Not found." });
    return;
  }

  const rateRoute = classifyHttpRoute(request.method, url.pathname);
  if (rateRoute && !deps.rateLimiter.tryConsume(rateRoute, clientRateLimitKey(request))) {
    writeJson(response, 429, { ok: false, error: "Rate limit exceeded." });
    return;
  }

  if (deps.dispatchChannelPluginHttp) {
    const handled = await deps.dispatchChannelPluginHttp(request, response, { requireGatewayAuth: false });
    if (handled) {
      return;
    }
  }

  if (!deps.isAuthorized(request)) {
    writeJson(response, 401, { ok: false, error: "Unauthorized." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, deps.healthPayload());
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    deps.openEventStream(request, response, url);
    return;
  }

  if (request.method === "POST" && url.pathname === "/channels/webhook") {
    const payload = await deps.runWebhook(await readJsonBody(request));
    writeJson(response, 200, { ok: true, payload });
    return;
  }

  if (request.method === "POST" && url.pathname === "/rpc") {
    const gatewayRequest = parseGatewayRequest(await readJsonBody(request));
    const gatewayResponse = await deps.handleRpc(gatewayRequest);
    writeJson(response, gatewayResponse.ok ? 200 : 400, gatewayResponse);
    return;
  }

  if (deps.dispatchChannelPluginHttp) {
    const handled = await deps.dispatchChannelPluginHttp(request, response, { requireGatewayAuth: true });
    if (handled) {
      return;
    }
  }

  writeJson(response, 404, { ok: false, error: "Not found." });
}
