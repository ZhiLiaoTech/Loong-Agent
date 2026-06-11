# Loong 产品架构与线上 Headless Runtime 任务清单

> 版本：v0.2
> 当前结论：Loong 面向线上多租户 Headless Runtime；ClawWorks-Server 负责租户、数字员工、AgentGate、计费与治理；Loong 负责 Suite 原生解析、实例物化、会话运行与工具执行。
> 明确不做：Tauri/Desktop Surface、OpenClaw 兼容层、客户端壳迁移。

## 1. 一句话结论

**Loong = Suite-aware TypeScript Runtime + Gateway + Core Agent Loop**。

Suite 是 Loong 的一等输入，不再先映射成另一套 Role/Workflow。Server 下发 Suite Release 与实例参数，Loong 直接从 Suite 工作区解析身份、技能、策略、UI 元数据和配置，并物化成可运行的租户隔离实例。

```text
ClawWorks-Server
  tenant / employee / billing / AgentGate / suite governance
        |
        | JSON-RPC over Loong Gateway
        v
Loong Headless Runtime
  @loong/gateway -> @loong/suite -> @loong/core -> tools / memory / sessions
        |
        v
{suiteDataDir}/instances/{tenantId}/{agentInstanceId}
```

## 2. 包职责

| 包 | 职责 |
|----|------|
| `@loong/suite` | 原生解析 Suite 工作区，安装 Suite Release，物化租户内 Agent Instance，生成运行时上下文。 |
| `@loong/gateway` | 暴露 Runtime RPC、Suite release install、Suite instance materialize、健康检查与后续 AgentGate 调用入口。 |
| `@loong/core` | 执行单轮或连续 Agent Turn，接入模型、工具、权限、事件与会话。 |
| `@loong/cli` | 本地运维入口；线上环境可用 `loong gateway --suite-data-dir` 启动 headless Gateway。 |
| `@loong/client` / `@loong/studio` | 可选浏览器工作台和 SDK，不参与线上 headless runtime 的核心闭环。 |

## 3. Suite 物化模型

Suite Release：

- 输入：Suite 工作区目录或解包后的发布目录。
- 解析：`suite.json`、`role.json`、`ui.json`、`policy.json`、`crons.json`、`soul/*`、`skills/*`、`config/*`、`schemas/*`。
- 输出：`{suiteDataDir}/suites/{suiteId}/{version}/workspace` 与 `suite-release.json`。

Suite Instance：

- 输入：`tenantId`、`agentInstanceId`、`suiteId`、`suiteVersion`、可选 `employeeId` 和业务 metadata。
- 输出：`{suiteDataDir}/instances/{tenantId}/{agentInstanceId}`。
- 目录：`workspace`、`sessions`、`memory`、`skills`。
- 记录：`suite-instance.json`。

Runtime Context：

- 直接由 Suite 身份与 soul 文档组成 system prompt。
- 技能来自 Suite `skills/*/SKILL.md`。
- 策略、UI、cron、config、schema 保留为结构化上下文。
- 不生成二次 Role/Workflow 映射文件。

## 4. 与 ClawWorks-Server 的集成

| Server 事件 | Loong 动作 |
|-------------|------------|
| Suite 发布或启用 | 调用 `suite.release.install`，Loong 安装或覆盖指定 release。 |
| 数字员工创建 | 调用 `suite.instance.materialize`，Loong 为租户和员工创建实例目录。 |
| AgentGate 调用 | Server 根据员工绑定关系路由到对应 Loong instance。 |
| 计费 | Server 记录租户、员工、模型消耗和调用链路；Loong 返回运行结果与可观测事件。 |
| 禁用/删除 | Server 决策；Loong 后续提供实例停用、归档、清理 RPC。 |

## 5. 下一阶段任务

### P0：物化闭环

- Suite release install / instance materialize RPC 已落地。
- 增加 Gateway 端到端测试，覆盖真实 HTTP RPC 与实例目录结果。
- 明确 Server 侧数字员工创建事务：数据库提交与 Loong 物化的重试/补偿。
- 为 `suiteDataDir` 制定线上挂载、备份、清理策略。

### P1：运行闭环

- AgentGate 到 Loong instance 的调用协议。
- Server 侧计费事件与 Loong trajectory/session 事件对齐。
- 实例级策略注入：模型限制、工具权限、并发限制、租户配额。
- 运行时健康探针与实例级诊断。

### P2：运维治理

- 实例归档、迁移、重建、版本升级。
- Suite Release 灰度与回滚。
- 多 Loong Gateway 节点注册、租户路由、容量调度。
- 审计日志与敏感数据清理。
