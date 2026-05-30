import type { IncomingMessage, ServerResponse } from "node:http";

export type LoongChannelHttpRouteAuth = "gateway" | "plugin";
export type LoongChannelHttpRouteMatch = "exact" | "prefix";

export interface LoongChannelHttpRouteRegistration {
  pluginId: string;
  path: string;
  match: LoongChannelHttpRouteMatch;
  auth: LoongChannelHttpRouteAuth;
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
}

export interface LoongChannelHttpDispatchOptions {
  requireGatewayAuth: boolean;
}

export function normalizeChannelHttpPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function matchChannelHttpPath(
  routePath: string,
  match: LoongChannelHttpRouteMatch,
  requestPath: string,
): boolean {
  if (match === "prefix") {
    return requestPath === routePath || requestPath.startsWith(`${routePath}/`);
  }
  return requestPath === routePath;
}

export async function dispatchChannelHttpRoutes(
  routes: readonly LoongChannelHttpRouteRegistration[],
  request: IncomingMessage,
  response: ServerResponse,
  options: LoongChannelHttpDispatchOptions,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://loong.local");
  const requestPath = url.pathname;
  for (const route of routes) {
    const wantsGatewayAuth = options.requireGatewayAuth;
    if (route.auth === "gateway" && !wantsGatewayAuth) {
      continue;
    }
    if (route.auth === "plugin" && wantsGatewayAuth) {
      continue;
    }
    if (!matchChannelHttpPath(route.path, route.match, requestPath)) {
      continue;
    }
    await route.handler(request, response);
    return true;
  }
  return false;
}
