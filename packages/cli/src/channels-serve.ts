import {
  startGatewayBridgeServer,
  type DragonChannelGatewayOptions,
  type GatewayBridgeServerOptions,
} from "@dragon/channels";

export type ChannelsServeOptions = GatewayBridgeServerOptions;

export async function runChannelsServe(options: ChannelsServeOptions) {
  return startGatewayBridgeServer(options);
}

export { createGatewayBridgeHandler } from "@dragon/channels";

export async function parseChannelsServeArgs(args: string[]): Promise<ChannelsServeOptions> {
  let host = process.env.DRAGON_CHANNELS_HOST?.trim() || "127.0.0.1";
  let port = parseOptionalPort(process.env.DRAGON_CHANNELS_PORT) ?? 17_358;
  let gatewayUrl = process.env.DRAGON_GATEWAY_URL?.trim()
    || process.env.DRAGON_CHANNELS_GATEWAY_URL?.trim()
    || "http://127.0.0.1:17357";
  let sharedSecret = process.env.DRAGON_GATEWAY_SECRET?.trim()
    || process.env.DRAGON_CHANNELS_GATEWAY_SECRET?.trim();
  let profileId = process.env.DRAGON_AGENT_PROFILE?.trim();
  let workspace = process.env.DRAGON_WORKSPACE?.trim();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") {
      host = args[index + 1]?.trim() ?? host;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--host=")) {
      host = arg.slice("--host=".length).trim();
      continue;
    }
    if (arg === "--port") {
      port = parsePortArg(args[index + 1], "--port");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--port=")) {
      port = parsePortArg(arg.slice("--port=".length), "--port");
      continue;
    }
    if (arg === "--gateway-url") {
      gatewayUrl = args[index + 1]?.trim() ?? gatewayUrl;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--gateway-url=")) {
      gatewayUrl = arg.slice("--gateway-url=".length).trim();
      continue;
    }
    if (arg === "--secret") {
      sharedSecret = args[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg?.startsWith("--secret=")) {
      sharedSecret = arg.slice("--secret=".length).trim();
      continue;
    }
    if (arg === "--profile") {
      profileId = args[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg?.startsWith("--profile=")) {
      profileId = arg.slice("--profile=".length).trim();
      continue;
    }
    if (arg === "--workspace") {
      workspace = args[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg?.startsWith("--workspace=")) {
      workspace = arg.slice("--workspace=".length).trim();
      continue;
    }
    throw new Error(`Unknown channels option: ${arg}`);
  }

  const defaults: DragonChannelGatewayOptions = {};
  if (profileId) {
    defaults.profileId = profileId;
  }
  if (workspace) {
    defaults.workspace = workspace;
  }

  return {
    host,
    port,
    gatewayUrl,
    ...(sharedSecret ? { sharedSecret } : {}),
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
  };
}

function parsePortArg(value: string | undefined, label: string): number {
  if (!value?.trim()) {
    throw new Error(`Usage: dragon channels serve ${label} <port>`);
  }
  return parsePort(value.trim());
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return parsePort(value.trim());
}
