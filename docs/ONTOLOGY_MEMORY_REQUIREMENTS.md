# Loong 用户级本体记忆需求说明

- 文档版本：V1.2
- 文档状态：需求评审稿
- 更新日期：2026-07-15
- 适用模块：`@loong/core`、`@loong/channels`、`@loong/gateway`、`@loong/memory`、`@loong/plugin-sdk`、`gateway-dashboard`

## 1. 项目定位

在 Loong 现有文本记忆、Session、Trajectory 和候选审核机制之上，增加用户级结构化语义层：

```text
原始会话 / Trajectory
        ↓
情景记忆 Episode
        ↓ 提取、审核、去重、冲突检测
结构化事实 Assertion
        ↓ 归并、时态更新、关系组织
用户语义模型
        ↓ 按当前任务检索和压缩
工作上下文 Context
```

项目中的“认知个体”定义为：

> 一个能够跨会话持续维护、解释、修正和遗忘的用户知识模型。

它不代表模拟意识或完整人格，也不应对用户进行无边界心理推断。

本项目采用轻量用户本体方案，优先解决用户隔离、事实归并、时态冲突、证据追溯和精准召回；首期不引入完整 OWL 推理机、RDF Store 或图数据库。

本项目的首要商业指标不是压缩磁盘数据，而是：在原始记忆和证据不丢失的前提下，通过可逆语义压缩与分层召回，尽可能减少每轮实际注入模型的 Prompt Token。

## 2. 项目目标

### 2.1 核心目标

- 实现租户和用户级记忆隔离。
- 完整保留原始 Session、Trajectory、工具结果和事实证据。
- 将重复的用户事实归并为结构化语义。
- 区分当前事实、历史事实和冲突事实。
- 根据当前任务精准召回相关用户知识。
- 显著减少重复和无关记忆占用的 Prompt Token。
- 在需要具体原因、时间、版本或过程时，能够从语义事实下钻到完整情景记忆。
- 保证每条认知都有来源、时间和可信度。
- 允许用户查看、纠正、撤销、导出和删除认知数据。
- 保持与现有 `MemoryStore`、Markdown、Session 和 Candidate 流程兼容。

### 2.2 非目标

首期不建设：

- 完整 OWL DL 推理能力。
- SPARQL 查询服务。
- Neo4j 或独立 RDF 数据库。
- 通用企业知识图谱平台。
- 自动生成完整人格或心理画像。
- 无审核的敏感属性推断。
- 用本体替代原始会话、Trajectory 和情景记忆。
- 把整个用户图谱直接注入模型上下文。
- 通过删除原始历史换取表面压缩率。
- 将磁盘存储压缩率或 RAM 降幅作为首期核心成功指标。

## 3. 当前实现基础

现有 Loong 记忆模块已经具备：

- `user/project/session/skill` 四种记忆 scope。
- File JSONL 和 SQLite FTS5 两种后端。
- Markdown 用户、项目和长期记忆注入。
- Session 历史压缩。
- `memory_search` 和 `memory_remember` 工具。
- 显式记忆请求的 Candidate 捕获。
- Candidate 的 promote/reject 审核流程。
- Gateway 渠道 `userId` 到 metadata 的传递。

现阶段主要缺口：

1. `scope: user` 只是标签，没有真正的用户级查询过滤。
2. `MemoryStore.search(query, limit)` 没有身份上下文。
3. 记忆仍然是自由文本，无法稳定归并。
4. 新旧偏好和决定无法表达替代关系。
5. 无法区分用户明确陈述与模型推断。
6. FTS 依赖词元相似度，无法进行关系型召回。
7. 没有“系统如何得出这个用户认知”的完整解释链。

## 4. 核心设计原则

### 4.1 身份先于本体

任何用户本体写入、查询、审核和删除都必须携带：

```ts
interface MemoryIdentity {
  tenantId: string;
  userId: string;
  agentInstanceId?: string;
}
```

在无法获得可信用户身份时：

- 可以保留 session 记忆。
- 不得写入用户级本体。
- 不得使用其他用户的语义画像。
- 不得仅凭昵称自动合并跨渠道身份。

### 4.2 情景与语义分离

- Episode 保存具体交互、时间、上下文和来源。
- Assertion 保存可复用的结构化语义。
- Profile Snapshot 是面向上下文注入的压缩投影。
- Snapshot 可以重建，不能作为唯一事实来源。

### 4.3 事实与推断分离

事实来源类型：

```ts
type AssertionSourceType =
  | "explicit"   // 用户明确陈述
  | "observed"   // 从可验证行为观察得到
  | "inferred"   // 模型推断
  | "imported";  // 外部系统导入
```

优先级原则：

```text
用户明确纠正
  > 用户明确陈述
  > 多次一致观察
  > 单次观察
  > 模型推断
```

模型推断不能自动覆盖用户明确事实。

### 4.4 保留历史，不直接覆盖

事实发生变化时：

- 新建 Assertion。
- 旧 Assertion 标记为 `superseded`。
- 建立 `supersedes` 关系。
- 保留原始证据和有效时间。
- 默认只召回当前有效事实。

### 4.5 有界召回

模型只接收当前任务相关的用户知识，不接收完整图谱。

召回结果必须经过：

- 用户身份过滤。
- 敏感度过滤。
- 状态过滤。
- 时间有效性过滤。
- 相关性排序。
- 置信度排序。
- Token 预算裁剪。

### 4.6 可逆语义压缩

本体、Assertion 和 Profile Snapshot 是原始记忆的语义投影，不是原始记忆的替代品。

- 原始 Session、Trajectory 和工具结果继续作为完整情景层保存。
- Assertion 必须关联可定位的 Episode 或 Evidence。
- Profile Snapshot 必须能够从当前有效 Assertion 重新生成。
- 默认 Prompt 只注入压缩后的当前相关语义。
- 用户询问日期、原因、错误信息、代码片段或历史变化时，系统必须能够按需加载原始 Evidence。
- 压缩、归并和 Snapshot 重建不得物理删除原始证据。

因此，本项目实现的是“存储无损、Prompt 有损选择、查询可逆下钻”：每轮模型不必看到全部记忆，但系统不能失去恢复完整信息的能力。

## 5. 轻量本体范围

### 5.1 首期实体类型

- `Person`
- `Organization`
- `Project`
- `Role`
- `Skill`
- `Tool`
- `Model`
- `Preference`
- `Constraint`
- `Goal`
- `Decision`
- `CommunicationStyle`
- `Episode`

### 5.2 首期关系类型

- `worksOn`
- `belongsTo`
- `hasRole`
- `hasSkill`
- `usesTool`
- `prefers`
- `avoids`
- `hasGoal`
- `madeDecision`
- `constrainedBy`
- `relatedToProject`
- `supportedByEpisode`
- `derivedFrom`
- `supersedes`

首期关系应采用受控词表，禁止模型随意生成无限的新谓词。

## 6. 核心数据模型

### 6.1 Entity

```ts
interface OntologyEntity {
  id: string;
  identity: MemoryIdentity;
  type: string;
  canonicalName: string;
  aliases: string[];
  status: "active" | "merged" | "deleted";
  sensitivity: "normal" | "personal" | "sensitive";
  createdAt: string;
  updatedAt: string;
}
```

### 6.2 Assertion

```ts
interface OntologyAssertion {
  id: string;
  identity: MemoryIdentity;

  subjectId: string;
  predicate: string;
  objectEntityId?: string;
  objectValue?: string | number | boolean;

  confidence: number;
  sourceType: AssertionSourceType;
  status:
    | "candidate"
    | "active"
    | "disputed"
    | "superseded"
    | "retracted";

  validFrom?: string;
  validTo?: string;
  evidenceIds: string[];

  createdAt: string;
  updatedAt: string;
}
```

### 6.3 Evidence

```ts
interface OntologyEvidence {
  id: string;
  identity: MemoryIdentity;
  sessionId?: string;
  runId?: string;
  messageId?: string;
  source: string;
  excerpt: string;
  capturedAt: string;
}
```

### 6.4 Profile Snapshot

```ts
interface UserProfileSnapshot {
  identity: MemoryIdentity;
  version: number;
  content: string;
  assertionIds: string[];
  estimatedTokens: number;
  generatedAt: string;
}
```

Snapshot 只包含稳定、高置信、当前有效且适合长期使用的认知。Snapshot 是可重建缓存，不是事实来源，也不能替代 Assertion、Evidence 或原始 Session。

## 7. 功能需求

### 7.1 P0：安全基础

#### FR-01 统一用户身份

- `LoongTurnInput` 增加正式的 `identity` 字段。
- Gateway、Channel、CLI 统一传递身份。
- 支持渠道身份到 canonical user 的显式映射。
- 身份映射变更必须保留审计记录。

#### FR-02 用户级存储隔离

- 所有记忆接口必须携带 `MemoryIdentity`。
- SQLite 查询必须强制包含 `tenant_id` 和 `user_id`。
- File 后端按租户和用户进行安全目录分区。
- Candidate、Episode、Assertion 和 Snapshot 使用相同隔离规则。
- 禁止以调用方传入的任意路径作为用户存储目录。

#### FR-03 兼容现有记忆接口

建议新增 `MemoryStoreV2`，保留原接口适配器：

```ts
interface MemorySearchContext {
  identity: MemoryIdentity;
  scope?: MemoryRecord["scope"];
  workspace?: string;
  now?: string;
}

interface MemoryStoreV2 {
  remember(
    context: MemorySearchContext,
    record: MemoryDraft,
  ): Promise<MemoryRecord>;

  search(
    context: MemorySearchContext,
    query: string,
    limit?: number,
  ): Promise<MemorySearchResult[]>;
}
```

旧数据迁移前只能作为本地单用户兼容数据，不得自动归属到某个线上用户。

### 7.2 P1：本体记忆 MVP

#### FR-04 本体候选提取

Lifecycle Hook 在成功回合结束后生成候选：

- 提取实体、关系、属性和时间。
- 保留原始 Evidence。
- 判断来源属于 explicit、observed 或 inferred。
- 不确定实体进入待消歧状态。
- 使用受控谓词词表。
- 敏感事实默认不提取。
- 普通推断不得静默进入 active 状态。

#### FR-05 审核与写入

扩展现有 Candidate 机制，支持：

- 查看结构化候选。
- 修改实体、关系和属性。
- 合并重复实体。
- Promote 为 active Assertion。
- Reject 并记录原因。
- 将候选标记为“不再询问同类事实”。

用户明确提出“记住”时仍需遵循现有权限策略。

#### FR-06 事实归并

写入前执行：

1. 实体别名解析。
2. 相同 Assertion 查找。
3. Evidence 归并。
4. 重复事实置信度更新。
5. 冲突检测。
6. 时态关系处理。
7. 结构约束验证。

相同事实不得产生多个并列 active Assertion。

#### FR-07 冲突与更新

示例：

```text
旧事实：用户 prefers Cursor
新事实：用户明确表示改用 VS Code
```

系统处理：

```text
Cursor preference → superseded
VS Code preference → active
VS Code assertion → supersedes → Cursor assertion
```

当无法确定是替代还是场景差异时，两者均标记为 `disputed` 或保留限定条件，不得自行选择。

### 7.3 P2：可逆压缩与分层召回

#### FR-08 语义压缩

Consolidator 按以下条件触发：

- 用户事实数量超过阈值。
- 同一谓词出现多个候选。
- 新事实与旧事实冲突。
- 累积一定数量的新 Episode。
- 用户主动要求整理记忆。
- 后台低优先级定时任务触发。

Consolidator 输出：

- 去重后的 Entity。
- 当前有效 Assertion。
- 历史和冲突关系。
- 更新后的 Profile Snapshot。
- 完整的变更审计记录。

Consolidator 不得删除原始 Session、Episode 或 Evidence。对于不再需要参与在线检索的历史内容，可以移出活跃索引或转入冷存储，但必须保持按身份、时间和来源可查询。

#### FR-09 本体上下文 Provider

新增：

```ts
createOntologyContextProvider()
```

执行流程：

```text
当前消息
  → 识别相关实体和意图
  → 强制用户身份过滤
  → 查询 Profile Snapshot
  → 查询相关 Assertion
  → 必要时查询一跳关系和最近 Episode
  → FTS 补充
  → 排序与 Token 裁剪
  → 自然语言投影
```

召回采用三级漏斗：

1. 用户核心认知：注入少量稳定偏好、角色和长期约束，建议控制在 100～500 Token。
2. 任务相关语义：注入与当前问题相关的 Assertion 和一跳关系，建议控制在 500～1500 Token。
3. 情景证据下钻：仅在需要准确时间、原因、过程、错误信息、代码片段、冲突消解或用户明确要求时加载 Episode、Evidence 或原始 Session。

前两级是默认在线上下文，第三级是按需调用。系统不得为了减少单轮 Token 而永久失去第三级信息。

#### FR-10 混合召回排序

建议排序因素：

- 当前问题相关性。
- 是否为用户明确事实。
- Assertion 置信度。
- 当前有效性。
- 最近确认时间。
- Evidence 数量。
- 与当前项目和 Agent 的关系距离。
- 是否存在争议。

关系查询首期限制为一跳，特殊场景最多两跳，防止无界扩散。

#### FR-11 上下文输出格式

推荐注入：

```text
Relevant user knowledge:
- 用户通常使用 TypeScript 开发 Loong。
- 用户要求修改脏仓库时保留无关本地改动。
- 当前项目的价格显示精度为三位小数。
- 用户过去使用 VS Code，目前已改用 Cursor。
```

默认不注入：

- 完整 Evidence 原文。
- 已 superseded 的旧事实。
- 低置信推断。
- 与当前任务无关的用户画像。
- 敏感属性。

当压缩事实不足以回答问题时，Provider 或记忆工具必须返回可供下钻的 Evidence 引用，而不是让模型根据压缩摘要猜测细节。

同一 Session 中已经注入且未变化的稳定事实，应避免在后续轮次重复展开；可以使用更短的稳定摘要或差量上下文，但必须保证模型仍能正确理解引用。

### 7.4 P3：用户控制能力

#### FR-12 查看与解释

用户可以询问：

- 你记得我什么？
- 为什么认为我偏好 Cursor？
- 这个结论来自哪次对话？
- 哪些是推断而不是我明确说的？
- 哪些认知存在冲突？

#### FR-13 纠正与遗忘

支持：

- 修改 Assertion。
- 否认 Assertion。
- 删除 Evidence。
- 删除实体。
- 删除某一类用户认知。
- 删除全部用户本体。
- 撤销错误实体合并。
- 重新生成 Profile Snapshot。

删除必须覆盖搜索索引、缓存、Snapshot 和上下文召回结果。

#### FR-14 导入导出

首期支持 JSON 导入导出，后续可增加 JSON-LD/RDF。

导出内容必须包含：

- Entity。
- Assertion。
- Evidence 元数据。
- 时态信息。
- 状态信息。
- 本体版本。

敏感 Evidence 原文是否导出应由用户单独确认。

## 8. 建议代码结构

```text
packages/memory/src/ontology/
  ontology-types.ts
  ontology-store.ts
  ontology-vocabulary.ts
  ontology-validator.ts
  sqlite-ontology-store.ts
  ontology-candidate-hook.ts
  ontology-resolver.ts
  ontology-consolidator.ts
  ontology-retriever.ts
  ontology-context-provider.ts
  ontology-provenance.ts
  ontology-snapshot.ts
```

关联改造：

- `@loong/core`：增加类型化用户身份。
- `@loong/channels`：输出稳定渠道身份。
- `@loong/gateway`：身份映射和本体 RPC。
- `@loong/memory`：存储、归并、召回和投影。
- `gateway-dashboard`：审核、解释、纠正和删除 UI。
- `@loong/plugin-sdk`：增加 Memory Backend V2 扩展契约。

## 9. SQLite 表设计

首期建议新增：

- `ontology_entities`
- `ontology_entity_aliases`
- `ontology_assertions`
- `ontology_evidence`
- `ontology_assertion_evidence`
- `ontology_episodes`
- `ontology_snapshots`
- `ontology_candidate_reviews`
- `ontology_audit_log`

核心索引：

```text
tenant_id + user_id
tenant_id + user_id + subject_id
tenant_id + user_id + predicate
tenant_id + user_id + status
tenant_id + user_id + valid_to
canonical_name
alias
```

首期继续使用 SQLite，不引入独立图数据库。

## 10. 安全和隐私要求

- 跨用户、跨租户泄漏必须视为最高级别缺陷。
- 敏感属性默认禁止模型推断。
- 所有写入必须记录来源和操作者。
- 用户纠正优先于模型推断。
- 用户删除后不得继续从 Snapshot 或缓存召回。
- 日志不得记录完整敏感 Evidence。
- 跨 Agent 共享必须显式授权。
- 自动实体合并必须使用高置信规则。
- 不得基于姓名、昵称或相似表达自动认定两个渠道用户是同一人。

## 11. 验收标准

### 11.1 安全验收

- 1000 次跨用户隔离测试中泄漏数为 0。
- 所有 SQLite 查询均通过身份过滤测试。
- 身份缺失时不能写入用户本体。
- 删除用户数据后搜索和上下文召回结果为 0。

### 11.2 功能验收

- 同一用户跨 Session 可以召回稳定事实。
- 已绑定渠道之间可以共享用户认知。
- 重复表达同一事实只保留一个 active Assertion。
- 新偏好可以替代旧偏好。
- 用户纠正后旧事实不再默认生效。
- 所有 active Assertion 都具有 Evidence。
- 用户可以查看事实来源和系统推断类型。

### 11.3 价值验收

MVP 是否继续扩大投入，应依据真实数据判断：

- 原始 Session、Trajectory、工具结果和 Evidence 保留率为 100%。
- Profile Snapshot 从 Assertion 重建的一致率为 100%。
- 所有压缩事实均能下钻到原始 Evidence。
- 稳定 active Assertion 重复量降低至少 50%。
- 相对 Loong 当前 Markdown + Session Compaction + FTS 基线，记忆 Prompt Token 平均降低至少 30%。
- 正式版本以记忆 Prompt Token 平均降低至少 60% 为目标。
- 对高重复、长期会话场景，以降低至少 80% 为挑战目标。
- 相对“完整历史直接注入”的理想场景可以评估 90%～95%，但不得作为所有场景的统一承诺。
- 过期事实错误召回率明显低于现有 FTS 基线。
- 标准个性化问答准确率不低于 85%。
- 事实、时态、冲突和证据问答准确率不得低于未压缩基线。
- 需要原始细节时的 Evidence 命中率不低于 95%。
- 用户纠正后旧事实继续生效率为 0。
- active Assertion 溯源覆盖率为 100%。
- 本体候选人工接受率达到 60% 以上。
- 本地一万条 Assertion 的 P95 查询时间低于 100ms。

如果 Token、准确率、Evidence 下钻能力和候选接受率未达到目标，应优先优化提取与召回，不扩大本体范围。任何以降低事实准确率、时间准确率或证据可追溯性为代价获得的 Token 降幅，都不能计入有效收益。

## 12. 实施路线

### 第一阶段：身份和隔离

- `MemoryIdentity`
- `LoongTurnInput.identity`
- MemoryStore V2
- SQLite/File 用户隔离
- 跨用户安全测试

### 第二阶段：轻量本体 MVP

- Entity、Assertion、Evidence、Episode
- 受控本体词表
- Candidate 提取和审核
- 约束验证
- 去重和实体解析

### 第三阶段：演化与压缩

- 冲突检测
- `supersedes`
- 有效时间
- Consolidator
- Profile Snapshot
- 原始 Evidence 引用和可逆重建验证

### 第四阶段：召回和注入

- Ontology Context Provider
- 本体、FTS 混合召回
- Token 预算
- 召回解释
- 三级召回漏斗
- Evidence 按需下钻
- 同 Session 差量上下文

### 第五阶段：用户控制面

- 查看认知
- 查看证据
- 纠正和撤销
- 删除和导出
- 实体合并管理

## 13. 经济价值与指标口径

本项目直接优化的是每轮模型输入成本，而不是单纯优化磁盘字节数。预期经济价值包括：

- 降低每轮模型输入 Token 成本。
- 降低首 Token 延迟和上下文预处理时间。
- 减少上下文超限、强制截断和无关记忆干扰。
- 延长同一用户在固定上下文预算下的有效生命周期。
- 允许在更小上下文或更低成本模型上保持个性化能力。
- 降低为了长上下文而升级高价模型的必要性。

必须分别测量以下指标，禁止将它们混合为一个笼统的“记忆压缩率”：

```text
Prompt Token 降幅
= 1 - 本体方案实际注入 Token / 基线方案实际注入 Token

活跃索引降幅
= 1 - 本体方案活跃索引大小 / 基线活跃索引大小

总磁盘变化
= 本体方案全部持久化数据 / 基线全部持久化数据 - 1

运行时 RAM 变化
= 本体方案峰值 RAM / 基线峰值 RAM - 1
```

首要指标是 Prompt Token 降幅；记忆准确率、Evidence 可恢复性和跨用户隔离是不可牺牲的约束指标。总磁盘和 RAM 作为观测指标，不作为首期成败的唯一判断依据。

## 14. 继续投入的决策门槛

本项目的核心不是“把记忆改造成知识图谱”，而是：

> 用最小必要的结构化能力，把重复、矛盾、不可解释的文本记忆，转化为按用户隔离、可追溯、可演化、可逆下钻、低 Prompt Token 的长期认知。

只有在轻量本体 MVP 通过实际 Prompt Token、记忆准确率、Evidence 恢复、候选质量和用户隔离指标后，才考虑更复杂的推理、向量检索、RDF 互操作或图数据库。
