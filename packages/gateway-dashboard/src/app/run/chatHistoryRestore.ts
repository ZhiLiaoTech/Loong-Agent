import { GatewayApiError, type GatewayClient } from "../../api/index.js";
import { pickAssistantDisplayText, stripTextToolBlocks } from "./chatDisplay.js";
import { loadLocalChatTurns, saveLocalChatTurns } from "./chatSessionStorage.js";
import { buildErrorDetail } from "./runFailure.js";
import type { ChatTurn } from "./types.js";

export const MAX_CHAT_TURNS = 80;
const RESTORE_TRAJECTORY_LIMIT = 40;

interface TrajectoryListItem {
  runId: string;
  createdAt: string;
  status?: string;
}

interface TrajectoryRecord {
  userMessage: string;
  assistantMessage?: string;
  status: string;
  error?: string;
}

export function normalizeChatSessionId(sessionId: string): string {
  return sessionId.trim() || "dashboard";
}

export function trimChatTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.length > MAX_CHAT_TURNS ? turns.slice(-MAX_CHAT_TURNS) : turns;
}

function trajectoryToTurns(record: TrajectoryRecord): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const userText = record.userMessage.trim();
  if (userText) {
    turns.push({ role: "user", text: userText, streaming: false });
  }

  const assistantText = pickAssistantDisplayText(record.assistantMessage ?? "", "");
  const failed = record.status === "error" || record.status === "cancelled" || record.status === "timeout";
  if (failed) {
    const failure = buildErrorDetail({
      phase: record.status === "cancelled" ? "cancelled" : record.status === "timeout" ? "timeout" : "error",
      ...(record.error ? { message: record.error } : {}),
    });
    turns.push({
      role: "assistant",
      text: assistantText || stripTextToolBlocks(record.error ?? "").trim(),
      streaming: false,
      ...failure,
    });
    return turns;
  }

  if (assistantText) {
    turns.push({ role: "assistant", text: assistantText, streaming: false });
  }
  return turns;
}

function isTrajectoryUnavailable(error: unknown): boolean {
  if (!(error instanceof GatewayApiError)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("trajectory store is not configured")
    || message.includes("trajectory store is not available")
    || message.includes("unknown trajectory");
}

export async function restoreChatHistoryFromGateway(
  client: GatewayClient,
  sessionId: string,
): Promise<ChatTurn[]> {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  let listPayload: { trajectories?: TrajectoryListItem[] };
  try {
    listPayload = await client.rpc<{ trajectories?: TrajectoryListItem[] }>("trajectory.list", {
      sessionId: normalizedSessionId,
      limit: RESTORE_TRAJECTORY_LIMIT,
    });
  } catch (error) {
    if (isTrajectoryUnavailable(error)) {
      return [];
    }
    throw error;
  }

  const summaries = [...(listPayload.trajectories ?? [])].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  if (!summaries.length) {
    return [];
  }

  const records = await Promise.all(
    summaries.map(async summary => {
      try {
        const payload = await client.rpc<{ record: TrajectoryRecord }>("trajectory.get", {
          sessionId: normalizedSessionId,
          runId: summary.runId,
        });
        return payload.record;
      } catch (error) {
        if (isTrajectoryUnavailable(error)) {
          return null;
        }
        return null;
      }
    }),
  );

  const turns: ChatTurn[] = [];
  for (const record of records) {
    if (!record) {
      continue;
    }
    turns.push(...trajectoryToTurns(record));
  }
  return trimChatTurns(turns);
}

/** Local sessionStorage first (instant), then gateway trajectories (authoritative). */
export async function hydrateChatHistory(
  client: GatewayClient,
  sessionId: string,
): Promise<ChatTurn[]> {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  const local = loadLocalChatTurns(normalizedSessionId);

  let remote: ChatTurn[] = [];
  try {
    remote = await restoreChatHistoryFromGateway(client, normalizedSessionId);
  } catch {
    remote = [];
  }

  const merged = remote.length >= local.length ? remote : local;
  if (merged.length > 0) {
    saveLocalChatTurns(normalizedSessionId, merged);
  }
  return merged;
}
