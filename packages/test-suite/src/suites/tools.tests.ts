import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  createFileSearchTool,
  createFileWriteTool,
  createShellRunTool,
  createWebSearchTool,
  type FileSearchInput,
  type FileSearchOutput,
  type FileWriteInput,
  type FileWriteOutput,
  type ShellRunInput,
  type ShellRunOutput,
  type ToolDefinition,
  type WebSearchInput,
  type WebSearchOutput,
} from "@loong/tools";
import type { TestCase } from "../runner.js";
import { assert, closeServer, isRecord, listenOnLoopback, runCli } from "../lib/test-helpers.js";

let invokeCounter = 0;

async function invoke<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  input: TInput,
  context: { workspace?: string; metadata?: Record<string, unknown> } = {},
): Promise<{ ok: boolean; output?: TOutput; error?: string }> {
  invokeCounter += 1;
  const result = await tool.invoke({
    id: `tc-${invokeCounter}`,
    name: tool.name,
    input,
    sessionId: "tools-test",
    ...(context.workspace !== undefined ? { workspace: context.workspace } : {}),
    metadata: context.metadata ?? {},
  });
  return {
    ok: result.ok,
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

async function tempWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "loong-tools-test-"));
}

// --- file_write ---------------------------------------------------------------

async function testFileWriteCreatesNestedFile(): Promise<void> {
  const ws = await tempWorkspace();
  try {
    const tool = createFileWriteTool();
    const result = await invoke<FileWriteInput, FileWriteOutput>(
      tool,
      { path: "src/new/hello.ts", content: "export const x = 1;\n" },
      { workspace: ws },
    );
    assert(result.ok, `file_write should succeed: ${result.error}`);
    assert(result.output?.created === true, "file_write should report created=true for a new file");
    const onDisk = await readFile(path.join(ws, "src/new/hello.ts"), "utf8");
    assert(onDisk === "export const x = 1;\n", "file_write should write the content and create parent dirs");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

async function testFileWriteOverwriteFalseRefusesExisting(): Promise<void> {
  const ws = await tempWorkspace();
  try {
    const tool = createFileWriteTool();
    await invoke<FileWriteInput, FileWriteOutput>(tool, { path: "a.txt", content: "one" }, { workspace: ws });
    const result = await invoke<FileWriteInput, FileWriteOutput>(
      tool,
      { path: "a.txt", content: "two", overwrite: false },
      { workspace: ws },
    );
    assert(!result.ok, "file_write with overwrite:false should refuse an existing file");
    assert(/already exists/.test(result.error ?? ""), "file_write refusal should explain the file already exists");
    assert((await readFile(path.join(ws, "a.txt"), "utf8")) === "one", "file_write must not clobber when refusing");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

async function testFileWriteBlocksPathEscape(): Promise<void> {
  const ws = await tempWorkspace();
  try {
    const tool = createFileWriteTool();
    const result = await invoke<FileWriteInput, FileWriteOutput>(
      tool,
      { path: "../escape.txt", content: "nope" },
      { workspace: ws },
    );
    assert(!result.ok, "file_write should reject a path escaping the workspace");
    assert(/escapes workspace/.test(result.error ?? ""), "file_write escape error should mention the workspace");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

// --- file_search regex --------------------------------------------------------

async function testFileSearchRegexMode(): Promise<void> {
  const ws = await tempWorkspace();
  try {
    await writeFile(path.join(ws, "notes.txt"), "alpha\nbeta\ngamma\n", "utf8");
    const tool = createFileSearchTool();

    const regexResult = await invoke<FileSearchInput, FileSearchOutput>(
      tool,
      { query: "^(alpha|gamma)$", regex: true, path: "." },
      { workspace: ws },
    );
    assert(regexResult.ok, `file_search regex should succeed: ${regexResult.error}`);
    const matchedLines = (regexResult.output?.matches ?? []).map(match => match.line).sort();
    assert(matchedLines.length === 2 && matchedLines[0] === 1 && matchedLines[1] === 3, "regex should match lines 1 and 3 only");

    const badRegex = await invoke<FileSearchInput, FileSearchOutput>(
      tool,
      { query: "(", regex: true },
      { workspace: ws },
    );
    assert(!badRegex.ok && /Invalid regex/.test(badRegex.error ?? ""), "invalid regex should error cleanly");

    const insensitive = await invoke<FileSearchInput, FileSearchOutput>(
      tool,
      { query: "ALPHA", caseInsensitive: true },
      { workspace: ws },
    );
    assert(insensitive.ok && (insensitive.output?.matches.length ?? 0) === 1, "caseInsensitive substring should match");

    const substring = await invoke<FileSearchInput, FileSearchOutput>(
      tool,
      { query: "alpha" },
      { workspace: ws },
    );
    assert(substring.ok && (substring.output?.matches.length ?? 0) === 1, "default substring search should still work");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

// --- shell_run ----------------------------------------------------------------

async function testShellRunExecutesCommand(): Promise<void> {
  const ws = await tempWorkspace();
  try {
    const tool = createShellRunTool();
    const result = await invoke<ShellRunInput, ShellRunOutput>(
      tool,
      { command: "echo loong-shell-run" },
      { workspace: ws },
    );
    assert(result.ok, `shell_run should execute: ${result.error}`);
    assert(result.output?.exitCode === 0, "shell_run should report exitCode 0 on success");
    assert(/loong-shell-run/.test(result.output?.stdout ?? ""), "shell_run should capture stdout");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

async function testShellRunBlocksCwdEscape(): Promise<void> {
  const ws = await tempWorkspace();
  try {
    const tool = createShellRunTool();
    const result = await invoke<ShellRunInput, ShellRunOutput>(
      tool,
      { command: "echo x", cwd: "../.." },
      { workspace: ws },
    );
    assert(!result.ok, "shell_run should reject a cwd escaping the workspace");
    assert(/escapes workspace/.test(result.error ?? ""), "shell_run cwd escape error should mention the workspace");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

function testShellRunPermissionDefaults(): void {
  const tool = createShellRunTool();
  assert(tool.permission === "ask", "shell_run must default to permission ask");
  assert((tool.capabilities ?? []).includes("execute"), "shell_run must declare the execute capability");
}

// --- web_search ---------------------------------------------------------------

async function withSearxngMock(run: (baseUrl: string) => Promise<void>): Promise<void> {
  let lastQuery: string | undefined;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/search") {
      lastQuery = url.searchParams.get("q") ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        results: [
          { title: "Result One", url: "https://example.com/1", content: "first snippet" },
          { title: "Result Two", url: "https://example.com/2", content: "second snippet" },
          { title: "Result Three", url: "https://example.com/3", content: "third snippet" },
        ],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const port = await listenOnLoopback(server);
  try {
    await run(`http://127.0.0.1:${port}`);
    assert(lastQuery !== undefined, "web_search should have issued a /search request to the SearXNG backend");
  } finally {
    await closeServer(server);
  }
}

async function testWebSearchSearxng(): Promise<void> {
  await withSearxngMock(async baseUrl => {
    const tool = createWebSearchTool({ provider: "searxng", searxngUrl: baseUrl });
    const result = await invoke<WebSearchInput, WebSearchOutput>(tool, { query: "loong agent", maxResults: 2 });
    assert(result.ok, `web_search should succeed: ${result.error}`);
    assert(result.output?.provider === "searxng", "web_search should report the searxng provider");
    assert((result.output?.results.length ?? 0) === 2, "web_search should respect maxResults bounding");
    assert(result.output?.results[0]?.title === "Result One", "web_search should map SearXNG titles");
    assert(result.output?.results[0]?.url === "https://example.com/1", "web_search should map SearXNG urls");
    assert(result.output?.results[0]?.snippet === "first snippet", "web_search should map SearXNG content to snippet");
  });
}

async function testWebSearchUnconfigured(): Promise<void> {
  const tool = createWebSearchTool({});
  const result = await invoke<WebSearchInput, WebSearchOutput>(tool, { query: "anything" });
  assert(!result.ok, "web_search with no backend should fail");
  assert(/not configured/.test(result.error ?? ""), "web_search should explain it is not configured");
}

// --- plugin discovery regression (missing root must not crash) ----------------

async function testMissingPluginRootDoesNotCrash(): Promise<void> {
  const missing = path.join(os.tmpdir(), `loong-no-such-plugins-${process.pid}-${Date.now()}`);
  let stderr = "";
  let message = "";
  try {
    await runCli(["chat", "--no-session", "hello"], { LOONG_PLUGIN_ROOTS: missing });
  } catch (error) {
    // No provider is configured in the CLI test env, so the run is expected to
    // fail — but it must fail on provider/model resolution, never on a missing
    // plugin directory (the regression we fixed).
    stderr = isRecord(error) && typeof error.stderr === "string" ? error.stderr : "";
    message = error instanceof Error ? error.message : String(error);
  }
  const combined = `${stderr}\n${message}`;
  assert(!/ENOENT/.test(combined), `missing plugin root must not raise ENOENT: ${combined}`);
  assert(!/realpath/.test(combined), `missing plugin root must not raise a realpath error: ${combined}`);
}

export const toolsTestCases: TestCase[] = [
  ["tools file_write creates nested file", testFileWriteCreatesNestedFile],
  ["tools file_write overwrite false refuses existing", testFileWriteOverwriteFalseRefusesExisting],
  ["tools file_write blocks path escape", testFileWriteBlocksPathEscape],
  ["tools file_search regex mode", testFileSearchRegexMode],
  ["tools shell_run executes command", testShellRunExecutesCommand],
  ["tools shell_run blocks cwd escape", testShellRunBlocksCwdEscape],
  ["tools shell_run permission defaults", async () => testShellRunPermissionDefaults()],
  ["tools web_search searxng backend", testWebSearchSearxng],
  ["tools web_search unconfigured error", testWebSearchUnconfigured],
  ["tools missing plugin root does not crash", testMissingPluginRootDoesNotCrash],
];
