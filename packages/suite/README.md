# @loong/suite

Suite (数字员工包) 的解析、安装与加载 —— **消费端**实现，兼容 ClawWorks `suite.json` 格式。

> P6-a 最小闭环：从**本地目录**安装一个 suite，转换为 Loong 的 agent profile + employee workspace 文件。下载/解压（网络安装）、gateway RPC、CLI 集成属于后续阶段（P6-c/d）。

## 它做什么

输入一个解压好的 suite 目录（含 `suite.json` 或 `workspace/suite.json`），输出：

1. 解析 `suite.json` → `SuiteManifest`（`permissions` 等 snake_case 字段归一化为 camelCase）。
2. 校验 `skills[]` 声明的每个技能都存在 `skills/<id>/SKILL.md`。
3. 拷贝到 `<dataRoot>/suites/<id>/`（staging → 原子换入；升级时保留 `memory.md`、`data/memory/`、`data/drafts/`）。
4. 生成 Loong employee-workspace 文件：
   - `SOUL.md` + `IDENTITY.md` → `role.md`
   - `AGENTS.md` + `HEARTBEAT.md` → `workflow.md`
   - `MEMORY.md` → `memory.md`
   - `manifest.skills` → `skills.enabled.json`
5. 在 `<dataRoot>/config/agents.json` 注册/更新一个 agent profile（`id / name / defaultModel / workspace / systemPrompt / toolsEnabled / memoryEnabled`）。

### 关于 ui.json

`ui.json` 会随包**原样保留**到 workspace，并记录在 `manifest.uiConfigPath`，但**从不解析、从不渲染**——仅为兼容 ClawWorks。

## 使用

```bash
# 构建
corepack pnpm --filter @loong/suite build

# 安装一个本地 suite（可用 ClawWorks 示例包）
node packages/suite/dist/cli.js install \
  /path/to/content-creator-suite-v1.2.0 \
  --data-root .loong

# 查看已安装
node packages/suite/dist/cli.js list --data-root .loong
```

编程接口：

```ts
import { installSuite, listInstalledSuites } from "@loong/suite";

const result = await installSuite("/path/to/suite-dir", { dataRoot: ".loong" });
// result.profileId 即可在 `loong agent --profile <id>` 中使用
```

## 设计说明

- **自包含**：仅依赖 Node 内置模块，不 import 其它 `@loong/*` 包，避免 project-reference 构建耦合；`SuiteAgentProfile` / employee 文件名按 `@loong/core`、`@loong/gateway` 的现有约定本地声明，写出的 JSON/文件结构与之一致。
- 数据根解析（`resolveLoongDataRoot`）复刻 `@loong/cli` 的顺序：`LOONG_DATA_ROOT` → 向上找 `.loong/` → 向上找 `pnpm-workspace.yaml` → `<cwd>/.loong`。

## 后续阶段

- P6-b：技能复制进技能根、`crons.json` 导入 cron job store、`permissions` → org tool policy。
- P6-c：网络安装（下载 zip + size 校验 + 原子升级 + digest/版本）。
- P6-d：`loong suite ...` 集成进主 CLI、gateway `suite.*` RPC、onboarding（`USER.md.template`）、pipeline → delegation。
