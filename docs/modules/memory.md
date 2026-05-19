# @dragon/memory 技术方案

## 1. 职责边界

**负责**：持久记忆（`MemoryStore`）、会话 transcript（`SessionStore`）、轨迹（`TrajectoryStore`）、Markdown 记忆上下文、会话压缩上下文、记忆候选审核（pending → promote/reject）、记忆/轨迹相关 Agent 工具与 Lifecycle Hook。

**不负责**：Agent 主循环（依赖 `@dragon/core` 类型与调用方注入）。

## 2. 对外 API（按域）

| 域 | 主要导出 |
|----|----------|
| 记忆 | `MemoryStore`、`createFileMemoryStore`、`createSqliteMemoryStore`、`createMemoryTools` |
| 会话 | `createFileSessionStore`、`createSessionCompactionContextProvider` |
| 轨迹 | `createFileTrajectoryStore`、`createTrajectoryTools` |
| 上下文 | `createMemoryContextProvider`、`createMarkdownMemoryContextProvider` |
| 候选 | `createMemoryCandidateTools`、`createMemoryCandidateLifecycleHook` |

**实现集中于** `packages/memory/src/index.ts`（约 3000+ 行单文件）。

## 3. 内部设计

### 3.1 存储后端

| 后端 | 路径/技术 | 检索 |
|------|-----------|------|
| `file`（默认） | `.dragon/memory/records.jsonl` | 令牌重叠打分（非 FTS） |
| `sqlite` | SQLite + FTS5 | BM25，回退 LIKE |

### 3.2 会话与压缩

- Session：`<sessionId>` → SHA256 文件名，JSONL turns。
- `createSessionCompactionContextProvider`：超出近期窗口的历史 → 确定性摘要注入上下文（不自动写 durable memory）。

### 3.3 记忆候选流

```text
用户「记住…」→ lifecycle hook 写 candidates/YYYY-MM-DD.jsonl
  → memory_candidates_list (allow)
  → promote (ask) → 写入 MemoryStore
  → reject (ask) → 审计记录，不写入
```

进程内 `memoryCandidateReviewLocks`，**无跨进程锁**。

### 3.4 Markdown 记忆

读取 `USER.md`、`PROJECT.md`、`MEMORY.md`、`notes/YYYY-MM-DD.md` 作为只读上下文（与 [MEMORY.md](../MEMORY.md) 一致）。

### 3.5 依赖

- `@dragon/core` — `DragonContextProvider`、`DragonLifecycleHook`、`DragonTrajectoryStore`
- `@dragon/tools` — 工具定义

## 4. 集成方式

CLI `createRuntime()`：

- `createFileSessionStore`、`createFileTrajectoryStore`
- 按 `DRAGON_MEMORY_BACKEND` 选择 file/sqlite/插件后端
- 注册 context providers 与 memory tools
- Gateway 通过 RPC `memory.candidates.*` 调用同名工具

## 5. Code Review

### 5.1 优点

- 候选记忆审核流避免模型自动污染长期记忆。
- 大量 `DEFAULT_*` / `ABSOLUTE_*` 边界常量，防 DoS。
- SQLite FTS 为本地搜索提供可扩展路径。
- 轨迹/会话 JSONL 便于人工审计与备份。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | 单文件巨型模块，测试与协作成本高 |
| P1 | `memory` 依赖 `core`，无法单独作为「存储库」复用 |
| P2 | File 后端搜索读全量 tail，规模变大后变慢 |
| P2 | `maxRecords` 写时不强制，仅读时 slice |
| P2 | 候选锁仅进程内；CLI + Gateway 双进程竞态 |
| P2 | `node:sqlite` 动态导入，旧 Node 失败路径依赖运行时 |
| P3 | 轨迹工具查询限制（31 文件/8MB）可能出乎运维预期 |

### 5.3 改进建议

1. 拆分为 `stores/`、`context/`、`tools/`、`candidates/` 子目录。
2. File 后端增加索引文件或迁移默认 sqlite。
3. 候选 promote 使用文件锁或原子 rename 策略。
4. 将 `DragonTrajectoryStore` 接口保留在 core，实现留在 memory 包（现状）— 文档明确「ports in core, adapters in memory」。
