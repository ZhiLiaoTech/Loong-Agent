/**
 * Loong Channel Plugin Host — shared types for hosting OpenClaw-format channel plugins
 * inside a single `loong gateway` process.
 */

export const OPENCLAW_PLUGIN_MANIFEST_FILE = "openclaw.plugin.json";

export interface OpenClawPluginManifest {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  channels?: readonly string[];
  configSchema?: Record<string, unknown>;
  entry?: string;
}

export interface LoongChannelPluginRegistration {
  pluginId: string;
  channelId: string;
  pluginRoot: string;
  manifest: OpenClawPluginManifest;
}

export interface LoongChannelInboundDelivery {
  channel: string;
  text: string;
  userId?: string;
  threadId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

export interface LoongChannelPluginHostStatus {
  host: "loong-channel-plugin-host";
  started: boolean;
  loadedPlugins: number;
  registeredChannels: readonly string[];
  httpRouteCount: number;
  warnings?: readonly string[];
}
