# 优化落地记录（架构差距分析 → 实现）

> 基于多智能体架构差距分析（功能完整性 / 执行效率 / 执行成本 / 三系统融合度四个维度，
> 逐条回到代码对抗式核验）。本表记录每条短板的落地实现与验证。
> 分支 `feat/perf-cost-completeness-opt`。验证基线：28 个非 desktop 包 typecheck 0 error，
> `@loong/test-suite` 81/81 通过。

## 执行成本（省 token）

| 编号 | 短板 | 实现 | Commit |
|------|------|------|--------|
| TOK-1/EFF-1 | 无 prompt 缓存，稳定前缀每轮全价重算 | Anthropic 适配器把 system 提示与最后一个 tool schema 标记 `cache_control:{type:"ephemeral"}`；解析 `cache_read_input_tokens` / `prompt_tokens_details.cached_tokens` 为 `cachedInputTokens` | `4213c2f` |
| TOK-2 | 三档调度默认关闭，旗舰省 token 功能开箱即死 | `TIER_DEFAULTS.enabled=true`，默认 fast 档**保能力**（只降 thinking + 上下文预算，不禁工具/记忆）；缺省 tiers.json 加载启用默认；agent 启动日志 | `4cd8ede` |
| TOK-3 | 按档工具门控只有布尔，22 个 schema 每次全发 | `ModelTierSpec.toolAllowlist/toolDenylist`，运行时按 runId 过滤模型可见工具集 | `4213c2f` |
| TOK-4 | reasoning_content 回灌历史每轮重发 | 工具循环里只保留最近一条 assistant 的 reasoning，剥离更早的 | `4cd8ede` |
| TOK-5 | OpenAI 流式路径 token 计量全盲 | 流式请求加 `stream_options:{include_usage:true}` | `4cd8ede` |
| TOK-7 | 记忆 context 每轮重注入无去重 | **由 TOK-1 涵盖**：记忆 context 块在 system 提示内，已纳入可缓存前缀；`composeSystemPrompt` 按优先级确定性排序，前缀稳定 | （随 `4213c2f`） |
| TOK-8 | tier 一次定终身无降档 | 工具循环跨过半数迭代后对剩余迭代收紧上下文 + 降 thinking（cool-down，仅缩不增） | `c11d84f` |

## 业务功能完整性

| 编号 | 短板 | 实现 | Commit |
|------|------|------|--------|
| COMP-1/LIN-1 | 无 plan mode / todo / allow-always | `todo_write`/`todo_read` 工具（会话级清单）；权限新增 `allow-always`（会话级标准授权，CLI `[y/a/n]`）；`loong agent --plan`（禁写工具 + 计划待批） | `ccdf399` |
| COMP-2 | 只读 git 工具未接默认注册表 | `git_status/diff/log` 工厂导出并接入默认 agent 工具集 | `4cd8ede` |
| COMP-3 | 无会话生命周期管理 | `SessionStore.list/delete` + `loong sessions list/show/delete` | `2f55a4b` |
| COMP-4 | 渠道无配置入口 | `channel-config` 写入 + `loong channels config list/get/set`（密钥脱敏） | `7310cf7` |
| COMP-7 | 无成本/预算追踪 | catalog `pricing` + `computeModelCostUsd` + 运行时 `usage.costUsd` | `782aca1` |

## 执行效率

| 编号 | 短板 | 实现 | Commit |
|------|------|------|--------|
| EFF-4/EFF-6 | org/agent 配置每工具/每轮重读 | employee/tool-policy/org/agent-config store 加 mtime 缓存 | `4cd8ede` |

## 三系统融合度

| 编号 | 短板 | 实现 | Commit |
|------|------|------|--------|
| LIN-5/COMP-6 | Cron 即发即忘，失败即丢 | 失败按上限指数退避重试，耗尽后死信（`lastStatus:"failed"`），保留原定时槽 | `4213c2f` |
| LIN-3/COMP-5 | 记忆自改进半开环 | `createMemoryCandidateLifecycleHook({autoPromote,store})`，`LOONG_MEMORY_AUTO_PROMOTE=1` 显式意图直接入库 | `c11d84f` |
| LIN-6 | 密钥比较时序侧信道 + 插件无隔离 | `crypto.timingSafeEqual` 比较网关密钥（`4cd8ede`）；插件信任 allowlist（导入前拦截，`LOONG_PLUGIN_ALLOWLIST`，`a0f0caa`） |

## 后续（更大面、低优先）

- LIN-2：成本感知 Provider 路由（RouteStrategy）+ 按会话/员工预算上限——建立在 COMP-7 之上。
- COMP-3：网关 `session.*` RPC、交互式 REPL、fork。
- COMP-4：网关 `connect.*` RPC + 看板配置 UI + 飞书/企微适配器。
- LIN-4：skill_improve 蒸馏回写 SKILL.md（与 protectedFile 设计冲突，需先评审）。
- LIN-6：插件 worker_thread 沙箱（需重构插件加载的函数序列化边界）。
