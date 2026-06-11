import path from "node:path";
import { createFileSessionStore } from "@loong/memory";
import { resolveLoongDataRoot } from "../loong-paths.js";

function sessionsDir(): string {
  return process.env.LOONG_SESSION_DIR?.trim() || path.join(resolveLoongDataRoot(), "sessions");
}

/**
 * `loong sessions` — manage persisted local sessions.
 *   loong sessions list            list sessions (newest activity first)
 *   loong sessions show <id>       print the last messages of a session
 *   loong sessions delete <id>     delete a session
 */
export async function runSessions(args: string[]): Promise<void> {
  const sub = args[0];
  const store = createFileSessionStore({ rootDir: sessionsDir() });

  if (sub === "list" || sub === undefined) {
    const list = store.list ? await store.list() : [];
    if (list.length === 0) {
      process.stdout.write("No sessions found.\n");
      return;
    }
    for (const summary of list) {
      const when = summary.updatedAt ?? summary.createdAt ?? "";
      const preview = summary.lastMessagePreview ? ` — ${summary.lastMessagePreview}` : "";
      process.stdout.write(`${summary.sessionId}\t${summary.turns} turn(s)\t${when}${preview}\n`);
    }
    return;
  }

  if (sub === "show") {
    const id = args[1]?.trim();
    if (!id) {
      throw new Error("Usage: loong sessions show <sessionId>");
    }
    const messages = await store.loadMessages(id);
    if (messages.length === 0) {
      process.stdout.write(`Session "${id}" has no messages (or does not exist).\n`);
      return;
    }
    for (const message of messages) {
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      process.stdout.write(`[${message.role}] ${content}\n`);
    }
    return;
  }

  if (sub === "delete" || sub === "rm") {
    const id = args[1]?.trim();
    if (!id) {
      throw new Error("Usage: loong sessions delete <sessionId>");
    }
    const removed = store.delete ? await store.delete(id) : false;
    process.stdout.write(removed ? `Deleted session "${id}".\n` : `Session "${id}" not found.\n`);
    return;
  }

  throw new Error(`Unknown sessions subcommand: ${sub}. Use list | show <id> | delete <id>.`);
}
