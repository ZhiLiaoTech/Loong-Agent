import { loadChannelConfig, maskChannelConfig, setChannelConfigValue } from "../channel-config.js";

/**
 * `loong channels config` — manage chat-channel credentials without hand-editing
 * channels.json.
 *   loong channels config list
 *   loong channels config get <channel>
 *   loong channels config set <channel> <key> <value>
 */
export async function runChannelsConfig(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "list" || sub === undefined) {
    const config = await loadChannelConfig();
    if (Object.keys(config).length === 0) {
      process.stdout.write("No channels configured. Use: loong channels config set <channel> <key> <value>\n");
      return;
    }
    process.stdout.write(`${JSON.stringify(maskChannelConfig(config), null, 2)}\n`);
    return;
  }

  if (sub === "get") {
    const channel = args[1]?.trim();
    if (!channel) {
      throw new Error("Usage: loong channels config get <channel>");
    }
    const masked = maskChannelConfig(await loadChannelConfig());
    process.stdout.write(`${JSON.stringify(masked[channel] ?? {}, null, 2)}\n`);
    return;
  }

  if (sub === "set") {
    const channel = args[1]?.trim();
    const key = args[2]?.trim();
    const value = args.slice(3).join(" ");
    if (!channel || !key || !value) {
      throw new Error("Usage: loong channels config set <channel> <key> <value>");
    }
    await setChannelConfigValue(channel, key, value);
    process.stdout.write(`Set ${channel}.${key}.\n`);
    return;
  }

  throw new Error(`Unknown channels config subcommand: ${sub}. Use list | get <channel> | set <channel> <key> <value>.`);
}
