# @dragon/gateway-dashboard

Gateway 内嵌 Dashboard 前端：**Vite + React 19**，构建为单文件 HTML 由 `@dragon/gateway` 在 `GET /` / `GET /dashboard` 提供。

## 双入口

| 入口 | URL | 说明 |
|------|-----|------|
| **Legacy**（默认） | `http://127.0.0.1:18787/` | `src/legacy-app.js` + `styles-legacy.css`，单页 Tab |
| **V2 React** | `http://127.0.0.1:18787/?ui=v2#/run` | Hash 路由；Gateway 仅对 `/` 返回 HTML，故路由用 `#/…` |

切换：查询参数 `?ui=v2` 由 `src/main.ts` 决定挂载 `#root`（React）或 `.app`（Legacy）。

## V2 路由

| Hash | 页面 | 主要 RPC |
|------|------|----------|
| `#/run` | 对话工作台 | `agent`, `run.cancel`, `runs.list`, `providers.list`, `agent.config.get` |
| `#/models` | Provider 配置 | `model.config.get`, `model.config.save`, `providers.list` |
| `#/agents` | Agent Profile | `agent.config.get`, `agent.config.save` |
| `#/observe` | 运行 / 事件 / Memory / 轨迹 | `runs.list`, SSE, `memory.candidates.*`, `trajectory.*` |
| `#/system` | 健康 / Cron / 插件 / 工具 | `/health`, `cron.*`, `plugins.list`, `tools.catalog`, `tool.invoke` |

侧栏数字：`useNavCounts` 每 8s 刷新；Run 在有活跃 run 时显示活跃数高亮；System 显示 Gateway 在线状态点。

## 开发

```bash
# 仓库根目录
corepack pnpm install
corepack pnpm --filter @dragon/gateway-dashboard dev
```

- Vite 默认 `http://127.0.0.1:5173/`
- V2：`http://127.0.0.1:5173/?ui=v2#/run`
- 需本地 Gateway 时另开终端：`node packages/cli/dist/index.js gateway --host 127.0.0.1 --port 18787`（Vite 代理或直连 Gateway 端口）

类型检查：

```bash
corepack pnpm --filter @dragon/gateway-dashboard check
```

## 构建与 Gateway 集成

```bash
corepack pnpm --filter @dragon/gateway-dashboard build
```

流程：`vite build` → `scripts/inline-html.mjs` 将 CSS/JS 内联进 `dist/index.html`（满足 test-suite 对 HTML 内 RPC 字符串的检查）。

`@dragon/gateway` 通过 `dashboard-static.ts` 读取 `packages/gateway-dashboard/dist/index.html`。

## 认证

- Bearer Secret 仅存在内存（`SecretProvider`），**不使用** `localStorage` / `sessionStorage`。
- Topbar 输入 Gateway `sharedSecret`；未授权时显示 `AuthBanner` 与启动命令提示。

## 目录结构

```
src/
  main.ts              # Legacy / V2 入口分流
  v2/main.tsx          # React 挂载
  app/
    routing/           # HashRouter + 页面路由
    shell/             # AppShell, Sidebar, useNavCounts
    events/            # 全局 SSE (EventsProvider)
    auth/              # useGatewayClient, useAuthGate
    secret/            # SecretProvider
    run/               # Run 工作台
    models/            # Models 配置
    agents/            # Agents 配置
    observe/           # Observe
    system/            # System
    api/               # RPC / SSE / health 客户端
  pages/               # 路由页薄封装
  styles/
    tokens.css         # 设计 token
    themes/            # light / dark
    v2-base.css        # 全局基础样式
    workspace.css      # 共享 workspace 按钮等
  legacy-app.js        # Legacy 实现（保留至完全下线）
```

## 主题

- `data-theme` 在 `<html>` 上切换 `light` / `dark`（`useThemeCycle`，不持久化到 storage）。
- 设计 token 见 `src/styles/tokens.css`。

## 测试

Dashboard 相关断言在 `@dragon/test-suite`（例如 HTML 须含 `providers.list`、`data-tab="run"` 等 manifest 字符串）：

```bash
corepack pnpm --filter @dragon/test-suite test
```

## 与 Legacy 的差异

| 项 | Legacy | V2 |
|----|--------|-----|
| 路由 | `data-tab` 单页 | HashRouter 分页 |
| 状态 | 单文件 `state` | React hooks + Context |
| Run UI | 表单 + 原始输出 | 聊天气泡 + 侧栏 Inspector |
| 构建 | 同包内联 HTML | 独立 Vite 包 + gateway 读 dist |

Legacy 仍可用于对照；新功能优先在 V2 实现。
