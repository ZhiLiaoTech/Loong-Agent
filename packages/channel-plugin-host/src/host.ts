import { readdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  dispatchChannelHttpRoutes,
  normalizeChannelHttpPath,
  type LoongChannelHttpDispatchOptions,
  type LoongChannelHttpRouteRegistration,
} from "./http-routes.js";
import { hasOpenClawPluginManifest, readOpenClawPluginManifest } from "./manifest.js";
import type {
  LoongChannelInboundDelivery,
  LoongChannelPluginHostStatus,
  LoongChannelPluginRegistration,
  OpenClawPluginManifest,
} from "./types.js";
import type { LoongOpenClawChannelRegistration, LoongOpenClawPluginApi } from "./openclaw-compat/api.js";
import { createLoongOpenClawPluginApi } from "./openclaw-compat/api.js";

export interface LoongChannelPluginHostOptions {
  pluginRoots: readonly string[];
  channelConfig?: Readonly<Record<string, unknown>>;
  deliverInboundMessage?: (message: LoongChannelInboundDelivery) => Promise<unknown>;
}

export class LoongChannelPluginHost {
  readonly #options: LoongChannelPluginHostOptions;
  readonly #registrations: LoongChannelPluginRegistration[] = [];
  readonly #channels: Array<LoongOpenClawChannelRegistration & { pluginId: string }> = [];
  readonly #httpRoutes: LoongChannelHttpRouteRegistration[] = [];
  #warnings: string[] = [];
  #started = false;

  constructor(options: LoongChannelPluginHostOptions) {
    this.#options = options;
  }

  get status(): LoongChannelPluginHostStatus {
    return {
      host: "loong-channel-plugin-host",
      started: this.#started,
      loadedPlugins: this.#registrations.length,
      registeredChannels: this.#channels.map(entry => String(entry.plugin.id)),
      httpRouteCount: this.#httpRoutes.length,
      ...(this.#warnings.length > 0 ? { warnings: [...this.#warnings] } : {}),
    };
  }

  async loadPluginRoots(): Promise<readonly LoongChannelPluginRegistration[]> {
    const discovered = await discoverOpenClawPluginRoots(this.#options.pluginRoots);
    const registrations: LoongChannelPluginRegistration[] = [];
    for (const pluginRoot of discovered) {
      const manifest = await readOpenClawPluginManifest(pluginRoot);
      const channelIds = manifest.channels?.length ? manifest.channels : [manifest.id];
      for (const channelId of channelIds) {
        registrations.push({
          pluginId: manifest.id,
          channelId,
          pluginRoot,
          manifest,
        });
      }
    }
    this.#registrations.splice(0, this.#registrations.length, ...registrations);
    return [...this.#registrations];
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#warnings = [];
    this.#channels.length = 0;
    this.#httpRoutes.length = 0;
    if (!this.#registrations.length) {
      await this.loadPluginRoots();
    }
    const activated = new Set<string>();
    for (const registration of this.#registrations) {
      if (activated.has(registration.pluginRoot)) {
        continue;
      }
      activated.add(registration.pluginRoot);
      try {
        await this.#activatePlugin(registration.pluginRoot, registration.manifest);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#warnings.push(`Failed to activate ${registration.manifest.id}: ${message}`);
      }
    }
    this.#started = true;
  }

  async stop(): Promise<void> {
    this.#started = false;
    this.#warnings = [];
    this.#channels.length = 0;
    this.#httpRoutes.length = 0;
  }

  async dispatchHttp(
    request: IncomingMessage,
    response: ServerResponse,
    options: LoongChannelHttpDispatchOptions,
  ): Promise<boolean> {
    if (!this.#started || this.#httpRoutes.length === 0) {
      return false;
    }
    return dispatchChannelHttpRoutes(this.#httpRoutes, request, response, options);
  }

  async #activatePlugin(pluginRoot: string, manifest: OpenClawPluginManifest): Promise<void> {
    const entry = manifest.entry ?? "dist/index.js";
    const entryPath = path.resolve(pluginRoot, entry);
    const entryStat = await stat(entryPath);
    if (!entryStat.isFile()) {
      throw new Error(`OpenClaw channel plugin entry not found: ${entryPath}`);
    }
    const moduleUrl = pathToFileURL(entryPath).href;
    const imported = await import(moduleUrl) as { default?: unknown };
    const plugin = imported.default;
    if (!plugin || typeof plugin !== "object") {
      throw new Error(`OpenClaw channel plugin must default-export a plugin object: ${manifest.id}`);
    }
    const record = plugin as { register?: (api: LoongOpenClawPluginApi) => unknown };
    if (typeof record.register !== "function") {
      throw new Error(`OpenClaw channel plugin must expose register(api): ${manifest.id}`);
    }
    const api = createLoongOpenClawPluginApi({
      pluginId: manifest.id,
      pluginRoot,
      channelConfig: this.#options.channelConfig ?? {},
      ...(this.#options.deliverInboundMessage
        ? { deliverInboundMessage: this.#options.deliverInboundMessage }
        : {}),
      onRegisterChannel: registration => {
        this.#channels.push(registration);
      },
      onRegisterHttpRoute: params => {
        const normalizedPath = normalizeChannelHttpPath(params.path);
        if (!normalizedPath) {
          this.#warnings.push(`Skipped HTTP route with empty path from ${params.pluginId}`);
          return;
        }
        if (params.auth !== "gateway" && params.auth !== "plugin") {
          this.#warnings.push(`Skipped HTTP route ${normalizedPath}: invalid auth mode`);
          return;
        }
        const match = params.match ?? "exact";
        const duplicate = this.#httpRoutes.find(
          entry => entry.path === normalizedPath && entry.match === match,
        );
        if (duplicate) {
          this.#warnings.push(`HTTP route already registered: ${normalizedPath} (${match})`);
          return;
        }
        this.#httpRoutes.push({
          pluginId: params.pluginId,
          path: normalizedPath,
          match,
          auth: params.auth,
          handler: params.handler,
        });
      },
    });
    await record.register(api);
  }
}

async function discoverOpenClawPluginRoots(pluginRoots: readonly string[]): Promise<string[]> {
  const discovered: string[] = [];
  const seen = new Set<string>();
  for (const rootInput of pluginRoots) {
    const root = await realpath(path.resolve(rootInput));
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      continue;
    }
    if (await hasOpenClawPluginManifest(root)) {
      if (!seen.has(root)) {
        seen.add(root);
        discovered.push(root);
      }
      continue;
    }
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(root, entry.name);
      if (await hasOpenClawPluginManifest(candidate)) {
        const resolved = await realpath(candidate);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          discovered.push(resolved);
        }
      }
    }
  }
  return discovered;
}
