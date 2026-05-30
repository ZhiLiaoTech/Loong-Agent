# Loong 产品架构与桌面一体化任务清单

> **版本**：v0.1（讨论稿）  
> **目标**：Loong 作为**一个产品**天然支持桌面应用；ClawWorks-Client 的外壳能力**内化**为 Loong monorepo 的 Host + Studio，而非「内核 + 外挂壳」。  
> **视觉**：沿用 ClawWorks 页面风格（`theme/tokens`、Sidebar、StatusBar、暗色优先）。  
> **关联**：[ARCHITECTURE.md](./ARCHITECTURE.md)（Kernel）、[GAP_CLOSURE_PLAN.md](./GAP_CLOSURE_PLAN.md)（内核能力补齐）、ClawWorks-Client `Docs/10-架构设计/04-ClawWorks架构设计文档.md`。

---

## 1. 设计结论（一句话）

**Loong = Kernel + Host + Client SDK + Studio**；Desktop 是默认 **Surface**，不是独立仓库里的「壳」。

```text
┌─────────────────────────────────────────────────────────────┐
│  Surfaces  交付面                                            │
│  Desktop（默认） · Browser · CLI · Headless                  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Studio  工作台 UI（ClawWorks 视觉 + Loong 功能路由）          │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Client  TS SDK（UI ↔ Gateway/Cloud 唯一契约）                 │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Host   本地宿主（Desktop 才有：进程/托盘/密钥/更新）         │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Kernel 现有 @loong/*（gateway · core · cli · memory …）   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 目标 monorepo 包图（新增）

| 包名 | 职责 | 来源参考 |
|------|------|----------|
| `@loong/client` | Gateway RPC/SSE、配置类型、连接与重试、Cloud API 封装 | ClawWorks `services/auth.ts`、`gateway.ts` 逻辑抽象 |
| `@loong/host` | Host 能力接口（TS）、Browser 空实现 / Desktop 由 Tauri 注入 | ClawWorks `tauriCommands.ts` 分组 |
| `@loong/ui` | Design tokens、布局、基础组件 | ClawWorks `src/theme/tokens.ts`、`components/layout/*` |
| `@loong/studio` | 完整工作台 SPA（路由、页面、状态） | ClawWorks `App.tsx` 路由 + Loong `gateway-dashboard` 能力页 |
| `@loong/desktop` | Tauri 工程、Rust Host 实现、安装包 | ClawWorks `src-tauri/*` |
| （已有）`@loong/gateway` 等 | Kernel，不变 | Loong-Agent 现状 |

**退役路径**：`@loong/gateway-dashboard` 页面迁入 `@loong/studio` 后，仅保留构建嵌入或删除独立入口。

---

## 3. Surface 能力矩阵（实现时对照）

| 能力 | Browser | Desktop |
|------|---------|---------|
| Run / Chat / Models / Agents | ✅ | ✅ |
| 自动启动 Gateway | ❌ | ✅ Host Watchdog |
| 配置热生效 | ✅ RPC | ✅ RPC + Host 可选重启 |
| Shared secret 会话保持 | sessionStorage | keyring + session |
| 系统托盘 / 关闭隐藏 | ❌ | ✅ |
| 应用自动更新 | ❌ | ✅ |
| 安装包 | ❌ | NSIS / DMG |
| 云端登录与配置下发 | 可选 | 可选 |

Studio 内统一：`host.getCapabilities()`，禁止散落 `window.__TAURI__` 判断。

---

## 4. 阶段总览

| 阶段 | 名称 | 周期（估） | 出口标准 |
|------|------|-----------|----------|
| **P0** | 契约与文档 | 1–2 周 | 接口定稿、包骨架可编译 |
| **P1** | Client SDK | 2 周 | Browser 可连 Gateway 完成 Run/配置读写 |
| **P2** | UI 设计系统 | 1–2 周 | tokens + 布局组件 Story/截图基线 |
| **P3** | Studio 一体化 | 3–4 周 | 替代 gateway-dashboard，Browser 可日常使用 |
| **P4** | Desktop Surface | 3–4 周 | 安装包可启停 Gateway + 托盘 |
| **P5** | 云端与发布 | 2–3 周 | 登录/配置下发/更新闭环 |
| **P6** | 扩展能力（可选） | 持续 | Suite/渠道等按路线图 |

**依赖主链**：`P0 → P1 → P3`；`P2` 与 `P1` 可并行；`P4` 依赖 `P1 + P3`；`P5` 依赖 `P4`。

---

## 5. 任务清单

状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成

**实施进度（2026-05-28）**：P0–P2 骨架完成；P3 完成（含 P3-12 冒烟）；P4-01/05/06 Watchdog+IPC POC；P4-02–04、P4-07+ 待续。

### P0-01 决策记录（v1，2026-05-28）

| 决策 | 结论 |
|------|------|
| Studio v1 路由范围 | **瘦路由**：Chat / Models / Agents / Settings / About；Observe/System/Channels 延后 P6 |
| Host Watchdog | **Rust 优先**（`packages/desktop/src-tauri`），Browser 仍手动 `loong gateway` |
| 对外产品名 | 窗口、Studio、代码包与 CLI 统一品牌 **Loong**（`@loong/*`、`loong` 命令） |

### P0 — 契约与仓库骨架

| ID | 任务 | 依赖 | 交付物 | 验收标准 |
|----|------|------|--------|----------|
| P0-01 | 评审并冻结本文档 v1.0 | — | 团队确认的架构章节 | 无「核+壳」双仓长期方案 | [x] |
| P0-02 | 在 `pnpm-workspace.yaml` 注册新包目录 | P0-01 | `packages/client` `host` `ui` `studio` `desktop` | `pnpm -r build` 空包可过 | [x] |
| P0-03 | 定义 `@loong/host` 能力接口 | P0-01 | `HostCapabilities`、`HostRuntime` 类型 | 覆盖：gateway、paths、crypto、tray、update、autostart | [x] |
| P0-04 | 定义 `@loong/client` 公共 API 面 | P0-01 | `GatewayClient`、`CloudClient` 接口草案 | 与现有 `gateway-dashboard/src/api` 对齐 | [x] |
| P0-05 | 定义 Studio 路由表 v1 | P0-01 | `docs/studio-routes.md` | `/` `/chat` `/models` `/agents` `/settings` `/login?` | [x] |
| P0-06 | 数据目录规范写入文档 | P0-01 | `docs/LOONG_DATA_DIRECTORIES.md` | `.loong` 与桌面 `%APPDATA%` 映射表 | [x] |
| P0-07 | 从 ClawWorks 整理「禁止带入」清单 | P0-01 | `docs/clawworks-migration-exclusions.md` | 列出 openclaw.mjs、openclaw.json 语义等 | [x] |

**P0 里程碑**：接口 PR 合并，空包 CI 绿。

---

### P1 — Client SDK（`@loong/client`）

| ID | 任务 | 依赖 | 交付物 | 验收标准 |
|----|------|------|--------|----------|
| P1-01 | 从 `gateway-dashboard/src/api` 抽取 RPC 层 | P0-04 | `client/src/gateway-rpc.ts` | 覆盖 model/agent/tier/providers/runs |
| P1-02 | 统一错误类型与重试策略 | P1-01 | `GatewayApiError`、401 处理 | 与现 Dashboard 行为一致 |
| P1-03 | SSE / 事件流封装 | P1-01 | `subscribeEvents()` | Run 页可收 lifecycle/delta |
| P1-04 | 配置读写高层 API | P1-01 | `getModelConfig` / `saveModelConfig` 等 | 单测 mock Gateway |
| P1-05 | `createBrowserHost()` 空实现 | P0-03 | `host/browser.ts` | capabilities 全 false，不抛错 |
| P1-06 | `createGatewayClient({ host, baseUrl, getSecret })` 工厂 | P1-01,P1-05 | 对外唯一构造入口 | Studio 不直接 fetch |
| P1-07 | 端口发现：读 Gateway health / 环境 | P1-01 | `resolveGatewayUrl()` | 默认 `127.0.0.1:17357` |
| P1-08 | test-suite 增加 client 契约测试 | P1-01 | `client.tests.ts` | 对 smoke gateway 跑通 RPC |

**ClawWorks 参考**：`ClawWorks/src/services/gateway.ts`（就绪状态机稍后 P3 迁入 Studio）

**P1 里程碑**：`pnpm --filter @loong/client test` 通过；示例脚本可 `get` model config。

---

### P2 — UI 设计系统（`@loong/ui`）

| ID | 任务 | 依赖 | 交付物 | 验收标准 |
|----|------|------|--------|----------|
| P2-01 | 迁入 ClawWorks design tokens | P0-02 | `ui/src/tokens.ts` | 暗/亮主题与 ClawWorks 一致 |
| P2-02 | 全局样式与 CSS 变量注入 | P2-01 | `ui/src/global.css` | `data-theme` 切换 |
| P2-03 | 布局：Sidebar | P2-01 | `Sidebar.tsx` | 路由高亮、折叠可选 |
| P2-04 | 布局：StatusBar | P2-01 | `StatusBar.tsx` | Gateway 状态占位 |
| P2-05 | 基础组件：Button / Input / Card / Table | P2-01 | `ui/src/components/*` | 无第三方 UI 库依赖 |
| P2-06 | 基础组件：Modal / Toast / Banner | P2-05 | 反馈组件 | Studio 可引用 |
| P2-07 | 图标与 App 品牌占位 | P2-01 | `AppIcon`、Loong 命名 | 替换 ClawWorks 文案为 Loong |
| P2-08 | 视觉回归基线（截图或 Story） | P2-03–P2-06 | `ui/README.md` 截图 | 与 ClawWorks 侧栏对比可接受 |

**ClawWorks 参考**：`ClawWorks/src/theme/tokens.ts`、`components/layout/Sidebar.tsx`

**P2 里程碑**：独立 Vite 预览页可展示 tokens + Sidebar。

---

### P3 — Studio 工作台（`@loong/studio`）

| ID | 任务 | 依赖 | 交付物 | 验收标准 |
|----|------|------|--------|----------|
| P3-01 | Studio 应用脚手架（Vite + React Router） | P1,P2 | `studio/src/main.tsx` | dev server 可开 |
| P3-02 | App 壳：Sidebar + StatusBar + 路由出口 | P2,P3-01 | `AppShell.tsx` | 对齐 ClawWorks 布局 |
| P3-03 | HostProvider + SecretProvider 接入 | P1-05,P1-06 | context | Browser 模式可手动填 secret |
| P3-04 | **Chat / Run** 页迁入 | P3-02 | `pages/Chat.tsx` | 源自 `gateway-dashboard` run | 完整对话 + SSE |
| P3-05 | **Models** 页迁入 | P3-02 | `pages/Models.tsx` | 保存即落盘 + 热生效提示 |
| P3-06 | **Agents** 页迁入 | P3-02 | `pages/Agents.tsx` | 档案 CRUD + 落盘 |
| P3-07 | **Settings** 页 v1 | P3-02 | Gateway 地址、secret、数据目录只读 | 显示 `configPath` |
| P3-08 | Gateway 就绪状态机（前端） | P1,P3-03 | `services/gatewayReadiness.ts` | 移植 ClawWorks `ensureGatewayReadyAfterConfigChange` 语义 |
| P3-09 | 启动引导：无 Gateway 时引导页 | P3-08 | `GatewayOffline.tsx` | CLI 启动说明 |
| P3-10 | 废弃独立 dashboard 入口说明 | P3-04–P3-06 | `gateway-dashboard/README` 指向 studio | Gateway 仍可提供静态资源过渡期 |
| P3-11 | Studio browser 构建产物 | P3-04–P3-07 | `studio/dist` | Gateway 可 `serve` 或独立 preview |
| P3-12 | E2E：Browser 连本地 Gateway | P3-11 | test-suite 或 playwright 草案 | 发一条 chat 成功 |

**ClawWorks 参考**：`App.tsx` 路由表、`services/gateway.ts`；Loong：`packages/gateway-dashboard/**`

**P3 里程碑**：日常开发只用 `pnpm studio:dev` + `loong gateway`，不再打开旧 dashboard。

---

### P4 — Desktop Surface（`@loong/desktop`）

| ID | 任务 | 依赖 | 交付物 | 验收标准 |
|----|------|------|--------|----------|
| P4-01 | Tauri 2 工程初始化 | P0-02,P3-11 | `packages/desktop/src-tauri` | `tauri dev` 打开 Studio |
| P4-02 | `tauri.conf`：CSP、端口、asset 协议 | P4-01 | 允许 localhost Gateway | 与 ClawWorks 对齐 |
| P4-03 | Rust `config.rs`：Loong 路径解析 | P0-06 | `LOONG_DATA_ROOT`、`.loong` | 与 `loong-paths.ts` 一致 |
| P4-04 | Rust `init.rs`：首次运行初始化 | P4-03 | 默认配置目录 | 幂等 |
| P4-05 | **Watchdog**：spawn `loong gateway` | P4-03 | `watchdog.rs` | 健康检查、退避重启 |
| P4-06 | IPC：start/stop/restart/health/logs | P4-05 | `commands/gateway.rs` | Studio 可调 |
| P4-07 | IPC：get/set 数据目录、export 日志 | P4-03 | `commands/system.rs` | 设置页可读 |
| P4-08 | 系统托盘与关闭隐藏 | P4-01 | `app_preferences.rs` | 行为同 ClawWorks |
| P4-09 | 开机自启动插件 | P4-01 | autostart | 设置开关 |
| P4-10 | `createTauriHost()` 注入 Studio | P1-05,P4-06 | `@loong/host/tauri` | capabilities 正确 |
| P4-11 | 密钥：keyring + 加密 auth | P4-03 | `crypto.rs` | 无明文落盘 |
| P4-12 | 捆绑运行时 manifest | P4-05 | `bundle-resources.manifest.json` | 锁 Node + cli dist 版本 |
| P4-13 | `prepare-bundled-resources` 脚本 | P4-12 | 打安装包前资源 | Windows CI 可跑 |
| P4-14 | NSIS 安装包 + 本地冒烟 | P4-13 | `release/` 产物 | 安装后一键可用 |
| P4-15 | Desktop 启动不写「请手动起 Gateway」 | P4-05,P4-10 | 首屏体验 | 30s 内 health 绿 |

**ClawWorks 参考**：`src-tauri/src/watchdog.rs`、`lib.rs` invoke 列表、`skills/clawworks-release-packager`

**P4 里程碑**：Windows 安装包；用户只打开 Loong 应用即可聊天。

---

### P5 — 云端与产品化

| ID | 任务 | 依赖 | 交付物 | 验收标准 |
|----|------|------|--------|----------|
| P5-01 | Cloud API 模块（`@loong/client/cloud`） | P1 | 登录、refresh、profile | 可配置 baseUrl |
| P5-02 | 登录页 UI | P3,P5-01 | `pages/Login.tsx` | JWT 写入 Host 安全存储 |
| P5-03 | `gateway-config` 拉取与合并 | P5-01,P4-11 | `applyRemoteGatewayConfig` | 写 `.loong/config/providers.json` |
| P5-04 | 配置变更后 Gateway 就绪（复用 P3-08） | P5-03 | 热更新/重启策略 | 无人工重启 |
| P5-05 | 应用更新检查与安装 | P4 | `checkUpdate` / 安装 IPC | 对齐 ClawWorks 更新流 |
| P5-06 | 诊断包导出与可选上传 | P4-07 | logs + config 脱敏 | 不含 apiKey |
| P5-07 | 品牌与关于页 | P2 | About Loong | 版本号来自 build |
| P5-08 | 文档：Loong 桌面用户指南 | P4-14 | `docs/LOONG_DESKTOP_USER.md` | 安装/排障 |

**ClawWorks 参考**：`Docs/10-架构设计/01-网关对接方案.md`、`services/auth.ts`

**P5 里程碑**：登录 ClawWorks 云（或 Loong 云）后自动注入模型配置并可用。

---

### P6 — 扩展能力（可选，按产品路线图）

| ID | 任务 | 依赖 | 说明 |
|----|------|------|------|
| P6-01 | 数字员工 / Suite 路由 | P3,P5 | ClawWorks `DigitalEmployees`、`suites` |
| P6-02 | 渠道中心 Channels | P4 | ClawWorks `commands/im.rs` → Loong channels |
| P6-03 | 任务中心 / Cron UI | P3 | 对接 `@loong/cron` RPC |
| P6-04 | Skills 市场 / 编辑器 | P3 | ClawWorks `SkillMarket`、`ContentEditor` |
| P6-05 | 分析页 Analytics | P3 | KPI / trajectory 可视化 |
| P6-06 | OpenClaw 配置迁移工具 | P4 | 一次性 import `openclaw.json` → `.loong` |

---

## 6. Kernel 侧并行项（不阻塞 Studio，但 Desktop 依赖）

与 [GAP_CLOSURE_PLAN.md](./GAP_CLOSURE_PLAN.md) 对齐，Desktop 前建议完成：

| ID | 任务 | 关联 |
|----|------|------|
| K-01 | Provider 热生效（已完成） | P3-05、P5-04 |
| K-02 | `loong-paths` 工作区根解析（已完成） | P4-03 |
| K-03 | Gateway 嵌入 Studio 静态资源或反代 | P3-11 |
| K-04 | ACP/WebSocket 聊天协议（若要对齐 ClawWorks Chat） | P3-04 可选 |
| K-05 | 统一默认端口与 discovery 文档 | P1-07 |

---

## 7. 从 ClawWorks-Client 迁移映射表

| ClawWorks 路径 | Loong 目标 | 阶段 |
|----------------|------------|------|
| `ClawWorks/src/theme/tokens.ts` | `@loong/ui` | P2 |
| `ClawWorks/src/components/layout/*` | `@loong/ui` | P2 |
| `ClawWorks/src/App.tsx` 路由壳 | `@loong/studio` | P3 |
| `ClawWorks/src/pages/Chat.tsx` | `@loong/studio` + Client SSE | P3 |
| `ClawWorks/src/services/gateway.ts` | `studio/services/gatewayReadiness.ts` | P3 |
| `ClawWorks/src/services/tauriCommands.ts` | `@loong/host` + desktop IPC | P4 |
| `ClawWorks/src-tauri/src/watchdog.rs` | `packages/desktop/src-tauri` | P4 |
| `ClawWorks/src-tauri/src/config.rs` | `packages/desktop` + `loong-paths` | P4 |
| `skills/clawworks-release-packager` | `packages/desktop/scripts` | P4 |
| `resources/runtime/openclaw` | **不迁移** → `loong gateway` 子进程 | — |

---

## 8. 开发命令（目标态）

```bash
# Kernel
pnpm -r build
node packages/cli/dist/index.js gateway

# Studio（Browser Surface）
pnpm --filter @loong/studio dev

# Desktop（默认 Surface）
pnpm --filter @loong/desktop tauri dev

# 发布
pnpm --filter @loong/desktop release
```

---

## 9. 风险与决策点

| 风险 | 缓解 |
|------|------|
| Studio 与 gateway-dashboard 长期双维护 | P3-10 设截止日期，Gateway 只 embed `studio/dist` |
| Tauri/Rust 人力 | P4 可先 Node Watchdog POC，再换 Rust |
| ClawWorks 与 Loong 双品牌 | P2-07 统一 Loong；Cloud API 可暂兼容 clawworks.cn |
| 安装包体积 | P4-12 只 bundling Node + cli dist，不 bundling 全量 OpenClaw |

**待决策**（P0-01 已拍板 v1，见文首「P0-01 决策记录」；重大变更走 v1.1 评审）：

1. ~~Desktop 第一版路由范围~~ → 瘦路由  
2. ~~Host 实现~~ → Rust Watchdog 优先  
3. ~~对外产品名~~ → Loong（产品）/ Loong（代号）

遗留：

1. `gateway-dashboard` 退役截止日：**2026-08-31**（之后 Gateway 仅 embed `studio/dist`）  
2. Cloud API 域名与 ClawWorks 兼容窗口

---

## 10. 建议排期（单人月粗估）

| 月份 | 重点 |
|------|------|
| M1 | P0 + P1 + P2 并行 |
| M2 | P3（Studio 替代 dashboard） |
| M3 | P4（Desktop 安装包） |
| M4 | P5 + P6 按需 |

---

## 11. 任务看板导入（扁平 checklist）

复制到 Issue/Project 时可用的 ID 列表：

```
P0-01 P0-02 P0-03 P0-04 P0-05 P0-06 P0-07
P1-01 P1-02 P1-03 P1-04 P1-05 P1-06 P1-07 P1-08
P2-01 P2-02 P2-03 P2-04 P2-05 P2-06 P2-07 P2-08
P3-01 P3-02 P3-03 P3-04 P3-05 P3-06 P3-07 P3-08 P3-09 P3-10 P3-11 P3-12
P4-01 P4-02 P4-03 P4-04 P4-05 P4-06 P4-07 P4-08 P4-09 P4-10 P4-11 P4-12 P4-13 P4-14 P4-15
P5-01 P5-02 P5-03 P5-04 P5-05 P5-06 P5-07 P5-08
P6-01 P6-02 P6-03 P6-04 P6-05 P6-06
K-01 K-02 K-03 K-04 K-05
```

---

*文档维护：架构变更请更新本节版本号与 P0-01 评审记录。*
