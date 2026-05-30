/**
 * OpenClaw plugin API compatibility surface provided by Loong Channel Plugin Host.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoongChannelHttpRouteAuth, LoongChannelHttpRouteMatch } from "../http-routes.js";
import type { LoongChannelInboundDelivery } from "../types.js";
import { createOpenClawChannelRuntimeShim, type OpenClawChannelRuntimeShim } from "./runtime-shim.js";

export interface LoongOpenClawChannelPlugin {
  id: string;
  [key: string]: unknown;
}

export interface LoongOpenClawChannelRegistration {
  plugin: LoongOpenClawChannelPlugin;
}

export interface LoongOpenClawHttpRouteParams {
  path: string;
  match?: LoongChannelHttpRouteMatch;
  auth: LoongChannelHttpRouteAuth;
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
}

export interface LoongOpenClawPluginRuntime extends OpenClawChannelRuntimeShim {}

export interface LoongOpenClawPluginApi {
  readonly runtime: LoongOpenClawPluginRuntime;
  readonly config: Readonly<Record<string, unknown>>;
  registerChannel(registration: LoongOpenClawChannelRegistration): void;
  registerHttpRoute(params: LoongOpenClawHttpRouteParams): void;
}

export interface CreateLoongOpenClawPluginApiOptions {
  pluginId: string;
  pluginRoot: string;
  channelConfig: Readonly<Record<string, unknown>>;
  deliverInboundMessage?: (message: LoongChannelInboundDelivery) => Promise<unknown>;
  onRegisterChannel: (registration: LoongOpenClawChannelRegistration & { pluginId: string }) => void;
  onRegisterHttpRoute: (params: LoongOpenClawHttpRouteParams & { pluginId: string }) => void;
}

export function createLoongOpenClawPluginApi(
  options: CreateLoongOpenClawPluginApiOptions,
): LoongOpenClawPluginApi {
  const runtime = createOpenClawChannelRuntimeShim({
    pluginId: options.pluginId,
    ...(options.deliverInboundMessage ? { deliverInboundMessage: options.deliverInboundMessage } : {}),
  });

  return {
    runtime,
    config: options.channelConfig,
    registerChannel(registration) {
      options.onRegisterChannel({
        ...registration,
        pluginId: options.pluginId,
      });
    },
    registerHttpRoute(params) {
      options.onRegisterHttpRoute({
        ...params,
        pluginId: options.pluginId,
      });
    },
  };
}

export function emptyPluginConfigSchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: true };
}
