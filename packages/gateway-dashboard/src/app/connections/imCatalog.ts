export type ImChannelStatus = "available" | "coming_soon";

export interface ImChannelDefinition {
  id: string;
  nameKey: string;
  descriptionKey: string;
  status: ImChannelStatus;
  accent: string;
  glyph: string;
}

export const IM_CHANNEL_CATALOG: readonly ImChannelDefinition[] = [
  {
    id: "wechat",
    nameKey: "connections.channels.wechat.name",
    descriptionKey: "connections.channels.wechat.description",
    status: "coming_soon",
    accent: "#07C160",
    glyph: "微",
  },
  {
    id: "wecom",
    nameKey: "connections.channels.wecom.name",
    descriptionKey: "connections.channels.wecom.description",
    status: "coming_soon",
    accent: "#2F7DFF",
    glyph: "企",
  },
  {
    id: "feishu",
    nameKey: "connections.channels.feishu.name",
    descriptionKey: "connections.channels.feishu.description",
    status: "coming_soon",
    accent: "#3370FF",
    glyph: "飞",
  },
  {
    id: "dingtalk",
    nameKey: "connections.channels.dingtalk.name",
    descriptionKey: "connections.channels.dingtalk.description",
    status: "coming_soon",
    accent: "#0089FF",
    glyph: "钉",
  },
  {
    id: "whatsapp",
    nameKey: "connections.channels.whatsapp.name",
    descriptionKey: "connections.channels.whatsapp.description",
    status: "coming_soon",
    accent: "#25D366",
    glyph: "W",
  },
  {
    id: "telegram",
    nameKey: "connections.channels.telegram.name",
    descriptionKey: "connections.channels.telegram.description",
    status: "available",
    accent: "#26A5E4",
    glyph: "T",
  },
  {
    id: "slack",
    nameKey: "connections.channels.slack.name",
    descriptionKey: "connections.channels.slack.description",
    status: "available",
    accent: "#E01E5A",
    glyph: "S",
  },
  {
    id: "discord",
    nameKey: "connections.channels.discord.name",
    descriptionKey: "connections.channels.discord.description",
    status: "coming_soon",
    accent: "#5865F2",
    glyph: "D",
  },
  {
    id: "line",
    nameKey: "connections.channels.line.name",
    descriptionKey: "connections.channels.line.description",
    status: "coming_soon",
    accent: "#06C755",
    glyph: "L",
  },
] as const;
