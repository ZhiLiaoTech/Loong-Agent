import type { LoongChannelInboundDelivery } from "../types.js";

export interface CreateOpenClawChannelRuntimeShimOptions {
  pluginId: string;
  deliverInboundMessage?: (message: LoongChannelInboundDelivery) => Promise<unknown>;
}

type InboundContext = Record<string, unknown>;

export type OpenClawChannelRuntimeShim = {
  host: "loong-channel-plugin-host";
  log: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string) => void;
  deliverInbound: (message: LoongChannelInboundDelivery) => Promise<unknown>;
  channel: {
    routing: {
      resolveAgentRoute: (params: {
        cfg: unknown;
        channel: string;
        accountId?: string;
        peer: { kind: string; id: string };
      }) => { sessionKey: string; accountId: string; agentId?: string };
    };
    reply: {
      finalizeInboundContext: (ctx: InboundContext) => InboundContext;
      dispatchReplyWithBufferedBlockDispatcher: (params: {
        ctx: InboundContext;
        cfg: unknown;
        dispatcherOptions: {
          deliver: (payload: { text?: string; mediaUrl?: string; mediaUrls?: string[] }) => Promise<void>;
          onSkip?: (payload: unknown, info: { kind: string; reason: string }) => void;
          onError?: (err: unknown, info: { kind: string }) => void;
        };
      }) => Promise<void>;
    };
  };
};

export function createOpenClawChannelRuntimeShim(
  options: CreateOpenClawChannelRuntimeShimOptions,
): OpenClawChannelRuntimeShim {
  const log = (message: string, meta?: Record<string, unknown>) => {
    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    process.stderr.write(`[loong-channel-plugin-host:${options.pluginId}] ${message}${suffix}\n`);
  };

  return {
    host: "loong-channel-plugin-host",
    log,
    error(message: string) {
      log(`ERROR: ${message}`);
    },
    async deliverInbound(message) {
      if (!options.deliverInboundMessage) {
        throw new Error("Loong Channel Plugin Host inbound delivery is not configured.");
      }
      return options.deliverInboundMessage(message);
    },
    channel: {
      routing: {
        resolveAgentRoute({ channel, accountId, peer }) {
          const account = accountId?.trim() || "default";
          const sessionKey = `loong:${channel}:${account}:${peer.kind}:${peer.id}`;
          return { sessionKey, accountId: account };
        },
      },
      reply: {
        finalizeInboundContext(ctx) {
          return { ...ctx };
        },
        async dispatchReplyWithBufferedBlockDispatcher({ ctx, dispatcherOptions }) {
          const channel = readString(ctx.OriginatingChannel) ?? readString(ctx.Surface) ?? "unknown";
          const text = readString(ctx.Body) ?? readString(ctx.RawBody) ?? "";
          const userId = readString(ctx.SenderId);
          const threadId = readString(ctx.SessionKey);
          const messageId = readString(ctx.MessageSid);
          try {
            if (!options.deliverInboundMessage) {
              dispatcherOptions.onError?.(new Error("inbound delivery not configured"), { kind: "delivery" });
              return;
            }
            const delivery = await options.deliverInboundMessage({
              channel,
              text,
              ...(userId ? { userId } : {}),
              ...(threadId ? { threadId } : {}),
              ...(messageId ? { messageId } : {}),
              metadata: { inboundContext: ctx },
            });
            const replyText = extractAssistantReplyText(delivery);
            if (replyText?.trim()) {
              await dispatcherOptions.deliver({ text: replyText });
            }
          } catch (error) {
            dispatcherOptions.onError?.(error, { kind: "delivery" });
          }
        },
      },
    },
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractAssistantReplyText(delivery: unknown): string | undefined {
  if (!delivery || typeof delivery !== "object") {
    return undefined;
  }
  const record = delivery as Record<string, unknown>;
  const result = record.result;
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const turn = result as {
    messages?: Array<{ role?: string; content?: string }>;
    assistantPreview?: string;
  };
  if (Array.isArray(turn.messages)) {
    const assistant = [...turn.messages].reverse().find(message => message.role === "assistant");
    if (typeof assistant?.content === "string" && assistant.content.trim()) {
      return assistant.content;
    }
  }
  if (typeof turn.assistantPreview === "string" && turn.assistantPreview.trim()) {
    return turn.assistantPreview;
  }
  return undefined;
}
