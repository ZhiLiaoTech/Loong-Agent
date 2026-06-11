import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface TodoWriteInput {
  todos: TodoItem[];
}

export interface TodoListOutput {
  todos: TodoItem[];
  summary: { total: number; completed: number; inProgress: number; pending: number };
}

const MAX_TODOS = 50;
const MAX_CONTENT_CHARS = 500;
const VALID_STATUS: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

const todoWriteSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          content: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "completed"] },
        },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
} as ToolJsonSchema;

const todoReadSchema: ToolJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/**
 * Session-scoped task checklist, the Claude-Code-style engineering-workflow
 * primitive. The model maintains a visible plan as it works; the list is
 * persisted (one JSON file per session, auditable) so it survives across turns
 * within a session and is surfaced back in every tool result.
 */
export function createTodoTools(rootDir: string): ToolDefinition[] {
  return [createTodoWriteTool(rootDir), createTodoReadTool(rootDir)];
}

function createTodoWriteTool(rootDir: string): ToolDefinition<TodoWriteInput, TodoListOutput> {
  return {
    name: "todo_write",
    description:
      "Record or update the task checklist for the current session. Pass the FULL list each call (it replaces the previous one). Use to plan and track multi-step work: mark exactly one item in_progress at a time and completed when done.",
    inputSchema: todoWriteSchema,
    capabilities: ["write"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const todos = parseTodoWriteInput(invocation.input);
        await writeTodos(rootDir, invocation.sessionId, todos);
        return toOutput(todos);
      });
    },
  };
}

function createTodoReadTool(rootDir: string): ToolDefinition<Record<string, never>, TodoListOutput> {
  return {
    name: "todo_read",
    description: "Read the current task checklist for this session.",
    inputSchema: todoReadSchema,
    capabilities: ["read"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const todos = await readTodos(rootDir, invocation.sessionId);
        return toOutput(todos);
      });
    },
  };
}

function toOutput(todos: TodoItem[]): TodoListOutput {
  return {
    todos,
    summary: {
      total: todos.length,
      completed: todos.filter(t => t.status === "completed").length,
      inProgress: todos.filter(t => t.status === "in_progress").length,
      pending: todos.filter(t => t.status === "pending").length,
    },
  };
}

function parseTodoWriteInput(input: unknown): TodoItem[] {
  if (!isRecord(input) || !Array.isArray(input.todos)) {
    throw new Error("todo_write requires a `todos` array.");
  }
  if (input.todos.length > MAX_TODOS) {
    throw new Error(`todo_write accepts at most ${MAX_TODOS} items.`);
  }
  return input.todos.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(`todo[${index}] must be an object.`);
    }
    const content = typeof raw.content === "string" ? raw.content.trim() : "";
    if (!content) {
      throw new Error(`todo[${index}].content must be a non-empty string.`);
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw new Error(`todo[${index}].content cannot exceed ${MAX_CONTENT_CHARS} chars.`);
    }
    if (!VALID_STATUS.includes(raw.status as TodoStatus)) {
      throw new Error(`todo[${index}].status must be one of ${VALID_STATUS.join(", ")}.`);
    }
    return { content, status: raw.status as TodoStatus };
  });
}

function todoFilePath(rootDir: string, sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  return path.join(rootDir, "todos", `${key}.json`);
}

async function writeTodos(rootDir: string, sessionId: string, todos: TodoItem[]): Promise<void> {
  const filePath = todoFilePath(rootDir, sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify({ sessionId, todos }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    try { await unlink(tempPath); } catch { /* best-effort */ }
    throw error;
  }
}

async function readTodos(rootDir: string, sessionId: string): Promise<TodoItem[]> {
  const filePath = todoFilePath(rootDir, sessionId);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.todos)) {
    return [];
  }
  return parsed.todos.filter((t): t is TodoItem =>
    isRecord(t) && typeof t.content === "string" && VALID_STATUS.includes(t.status as TodoStatus));
}

async function safelyInvoke<TOutput>(
  invocation: ToolInvocation,
  fn: () => Promise<TOutput>,
): Promise<ToolResult<TOutput>> {
  try {
    return { id: invocation.id, ok: true, output: await fn() };
  } catch (error) {
    return { id: invocation.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
