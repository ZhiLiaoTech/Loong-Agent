# @dragon/tools 技术方案

## 1. 职责边界

**负责**：工具契约（`ToolDefinition`）、注册表、权限规则引擎、内置 Agent 工具（文件/Shell/Sandbox/浏览器/Patch）、工作区路径安全。

**不负责**：模型调用、会话持久化、Gateway RPC。

## 2. 对外 API

| 类别 | 符号 |
|------|------|
| 类型 | `ToolDefinition`、`ToolInvocation`、`ToolResult`、`ToolCapability`、`ToolPermissionEngine` |
| 注册表 | `createToolRegistry`、`DefaultToolRegistry` |
| 权限 | `createToolPermissionEngine`、`DefaultToolPermissionEngine` |
| 内置工具 | `createFileReadTool`、`createFileSearchTool`、`createFilePatchTool`、`createShellExecTool`、`createSandboxExecTool`、`createBrowserSnapshotTool`、`createBrowserFormSubmitTool` |
| 辅助 | `resolveWorkspacePath`、`isPathInside`、`planSandboxExecCommand` |

## 3. 内部设计

### 3.1 工具契约

每个工具包含：

- `name`、`description`、`inputSchema`（JSON Schema 对象，**本包不做运行时校验**）
- `capabilities`: `read` \| `write` \| `network` \| `memory` \| `custom` 等
- `permission`: 基线 `allow` \| `ask` \| `deny`（可与规则合并取更严）
- `invoke(ctx, input)` → `ToolResult`

注册时 `Object.freeze`，重名注册抛错。

### 3.2 权限引擎

规则匹配：`toolName`、`capability`、`when` 条件；**deny 优先**；默认决策默认 `ask`。

与 [PERMISSIONS.md](../PERMISSIONS.md) 一致：读 allow、写/网络/shell ask、破坏性 deny。

### 3.3 内置工具要点

| 工具 | 安全机制 |
|------|----------|
| `file_read` / `file_search` | 工作区 `realpath`、跳过 `node_modules`/`.git`、大小上限 |
| `file_patch` | 精确文本替换 / unified diff；`permission: ask` |
| `shell_exec` | 无 shell 元字符；argv 白名单；输出 64k  cap |
| `sandbox_exec` | 同上 + local/docker/ssh；profile：`inspect`、`git-read`、`search-read`、`repo-read` |
| `browser_snapshot` / `browser_form_submit` | 轻量 HTTP fetch；SSRF 防护；表单 GET/urlencoded POST |
| `browser_playwright_snapshot` | 可选 `playwright` + Chromium；用于 SPA/JS 渲染页（未安装时返回明确错误） |

### 3.4 MCP 适配（stdio + HTTP）

- 配置：`.dragon/config/mcp.json`，每项需 `id` 与 **`command`（stdio）** 或 **`url`（HTTP）** 之一。
- `registerMcpTools(registry, { servers })`：连接 MCP 服务、拉取 `tools/list`，注册为 `mcp_<serverId>_<toolName>`，默认权限 `ask`。
- **stdio**：`McpStdioClient` 子进程 + 换行分隔 JSON-RPC。
- **HTTP**：`McpHttpClient` 向 `url` POST JSON-RPC，支持 `mcp-session-id` 与 `text/event-stream` 响应体。

### 3.5 与 Runtime 并行执行

- `@dragon/core` 的 `canRunToolCallsInParallel`：同一轮多个 tool call 均为 **baseline `permission: allow`** 且能力仅含 `read` / `network` 时并行执行（例如并行的 `file_read` + `browser_snapshot`）。
- `write` / `execute` / `custom` / `memory` 能力或 `ask` 权限的工具仍串行。

### 3.6 依赖

无 workspace 依赖（纯 Node + 可选子进程/docker/ssh）。

## 4. 集成方式

CLI `createAgentTools(workspace, options)` 注册到 `ToolRegistry`；Gateway 接收同一 registry 用于 `tools.catalog` / `tool.invoke`。

Core `runtime` 在 `#runToolCall` 中：`permissionEngine.evaluate` → handler → `tool.invoke`。

## 5. Code Review

### 5.1 优点

- 工作区边界 + 命令白名单纵深防御。
- Sandbox 与 shell 分离，Docker/SSH 显式目标，降低误用。
- 注册表不可变，防止运行时篡改工具定义。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | `inputSchema` 无运行时校验，恶意/错误参数直达 invoke |
| P1 | Browser 无 SSRF 防护（localhost、内网 IP） |
| P2 | `normalizeToolName` 仅 trim，无大小写规范 |
| P2 | 无 matcher 的 permission rule 永不匹配 |
| P2 | `file_read` 跟随 symlink realpath，`file_search` 跳过 symlink — 语义不一致 |
| P3 | Git 白名单随需求扩展易漂移 |

### 5.3 改进建议

1. 引入轻量 JSON Schema 校验（或 zod）在 `invoke` 前。
2. Browser 增加 URL blocklist（RFC1918、metadata、file 协议）。
3. 导出 `validateToolInput(schema, input)` 供 core 统一调用。
4. 将 builtin 拆到独立目录并补充包级单元测试。
