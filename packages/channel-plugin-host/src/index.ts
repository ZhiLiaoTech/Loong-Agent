/**
 * Loong Channel Plugin Host
 *
 * Hosts OpenClaw-format channel plugins (e.g. openclaw-china) inside a single
 * `loong gateway` process. No sidecar OpenClaw runtime.
 */

export { LoongChannelPluginHost, type LoongChannelPluginHostOptions } from "./host.js";
export {
  hasOpenClawPluginManifest,
  readOpenClawPluginManifest,
} from "./manifest.js";
export {
  OPENCLAW_PLUGIN_MANIFEST_FILE,
  type LoongChannelInboundDelivery,
  type LoongChannelPluginHostStatus,
  type LoongChannelPluginRegistration,
  type OpenClawPluginManifest,
} from "./types.js";
