/**
 * OpenClaw plugin SDK compatibility surface implemented by Loong Channel Plugin Host.
 * Channel plugins authored for OpenClaw can import from `openclaw/plugin-sdk`.
 */

export type {
  LoongOpenClawChannelPlugin as ChannelPlugin,
  LoongOpenClawChannelRegistration,
  LoongOpenClawHttpRouteParams,
  LoongOpenClawPluginApi as OpenClawPluginApi,
  LoongOpenClawPluginRuntime,
} from "@loong/channel-plugin-host/openclaw-compat";

export {
  emptyPluginConfigSchema,
} from "@loong/channel-plugin-host/openclaw-compat";
