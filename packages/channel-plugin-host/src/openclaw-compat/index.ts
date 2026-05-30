/**
 * `@loong/channel-plugin-host/openclaw-compat`
 *
 * Compatibility exports for OpenClaw-format channel plugins running under
 * Loong Channel Plugin Host. Workspace packages may alias this to `openclaw/plugin-sdk`.
 */

export type {
  LoongOpenClawChannelPlugin,
  LoongOpenClawChannelRegistration,
  LoongOpenClawHttpRouteParams,
  LoongOpenClawPluginApi,
  LoongOpenClawPluginRuntime,
} from "./api.js";

export {
  createLoongOpenClawPluginApi,
  emptyPluginConfigSchema,
} from "./api.js";

export {
  createOpenClawChannelRuntimeShim,
  type CreateOpenClawChannelRuntimeShimOptions,
  type OpenClawChannelRuntimeShim,
} from "./runtime-shim.js";
