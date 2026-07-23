# Loong 三大核心设计 vs 业界前沿（2026-07 调研）

- 文档版本：V1.0
- 调研日期：2026-07-23
- 关联文档：[ONTOLOGY_MEMORY_REQUIREMENTS.md](../ONTOLOGY_MEMORY_REQUIREMENTS.md) · [DETERMINISTIC_ORCHESTRATION_DESIGN.md](../DETERMINISTIC_ORCHESTRATION_DESIGN.md) · [OBLIGATION_EVIDENCE_CHAIN_DESIGN.md](../OBLIGATION_EVIDENCE_CHAIN_DESIGN.md)
- 调研方法：网络公开资料检索（arxiv 论文、厂商官方文档、2026 年 5–7 月行业对比报告），出处见文末附录

## 0. 一句话结论

Loong 的三份核心设计（本体记忆、确定性编排、任务契约验收）**方向均与 2026 年业界收敛答案一致**；
任务契约命中业界公认空白（evaluation–enforcement gap），领先半个身位；
记忆层治理维度超前，但召回、提取、基准评测三项存在硬差距。

---

## 1. 本体记忆层

### 1.1 业界格局（2026 三分天下）

| 系统 | 核心架构 | 关键指标（厂商发布，方向性参考） |
|------|---------|--------------------------------|
| **Zep / Graphiti** | 时序知识图谱（Neo4j），bitemporal 版本管理，BM25+向量+图遍历三路混合召回 | DMR 基准 94.8%；LongMemEval +18.5%；延迟比全上下文基线低 90% |
| **Mem0** | 向量+图双层，LLM 提取管线，user/session/agent 三级 scope；2026 新算法：单遍提取、实体链接、多信号召回、时序推理 | LongMemEval 93.4%（旧版 49.0%）；LoCoMo 91.6；~59k GitHub stars |
| **Letta（前 MemGPT）** | Agent 用工具调用自主管理记忆（类 OS 分页：core/recall/archival） | Terminal-Bench 模型无关开源编程 Agent 第一 |

其他值得关注的学术方向：MAGMA（语义/时序/因果/实体四正交图层）、SimpleMem（摄入时无损重述消歧 + LLM 检索规划）、带形式化信念修正（belief revision）对应关系的记忆系统、Mastra Observational Memory（Observer/Reflector 后台压缩）。

### 1.2 Loong 对齐的部分

- 时态有效性（`validFrom/validTo` + `supersedes`）≈ Graphiti 时序图的核心能力
- Episode 情景层 + Evidence 溯源 ≈ Graphiti 的 provenance
- 受控本体词表 ≈ Graphiti 的 prescribed ontology
- 混合召回（本体 + FTS）≈ 业界 hybrid retrieval 的雏形

### 1.3 Loong 超前的部分（差异化护城河）

arxiv 记忆系统综述指出现有五大系统的**共同隐含假设**：

| 隐含假设 | 业界现状 | Loong 现状 |
|---------|---------|-----------|
| 治理由外部系统负责 | 记忆系统内部无治理层 | 审核队列、来源分级、删除完备性内嵌 |
| 遗忘等于删除 | 无"存在但不调用"中间态 | superseded/retracted/disputed 状态机 |
| 安全是数据保护问题 | 非身份完整性问题 | tenant+user 强制隔离（1000 次测试零泄漏） |
| 记忆属于用户/会话 | — | 一致 |

**对企业 SaaS 定位而言，"治理内嵌"恰好是行业公认空白，是我们最应放大的卖点。**

### 1.4 三处硬差距

| # | 差距 | 业界做法 | Loong 现状 | 行动 |
|---|------|---------|-----------|------|
| G1 | 召回质量 | 向量 + BM25 + 图遍历三路融合（Graphiti/Mem0 标配） | 实体名/别名**子串匹配**，无语义相似度 | 增加向量召回通道（embedding + ANN，与现有排序融合） |
| G2 | 提取质量 | 全部 LLM 提取（Mem0 单遍提取；SimpleMem 摄入时消歧共指与时态） | 正则启发式（`createHeuristicOntologyExtractor`），接口已可插拔 | 实现 LLM 提取器作为默认，启发式降级为兜底 |
| G3 | 基准评测缺失 | LoCoMo / LongMemEval / DMR 为事实标准 | 仅自建单元/E2E 测试 | 建立 LoCoMo + LongMemEval 评测脚本，产出可对外引用的数字 |

### 1.5 需求文档预判验证

`ONTOLOGY_MEMORY_REQUIREMENTS.md` §14 的决策门槛（"轻量本体 MVP 通过实际指标后，才考虑向量检索或图数据库"）与调研结论一致：**现在已到该判断点，且答案应为"上向量召回，仍不上独立图数据库"**——SQLite 单库 + 向量索引即可覆盖 Graphiti 能力面的核心子集，且保留私有化部署优势。

---

## 2. 确定性编排

### 2.1 业界收敛答案（2026）

- **混合骨架（Hybrid Backbone）**：确定性骨架编排流程，LLM 智能只部署在特定步骤；被 Anthropic 工程指南称为 "winning 2026 approach"
- **生产定型分层**：**Temporal**（耐久执行：事件溯源、replay、补偿、跨天等待）+ **LangGraph**（LLM 子任务：图状态、工具调用、HITL interrupt）
- 五大定型模式：Hybrid Backbone / Orchestrator-Worker / Supervisor 多 Agent / **Pipeline + Validation Gates** / Fan-Out Fan-In
- Temporal 2026 里程碑：Nexus GA（跨命名空间工作流互调，多 Agent 集群可参照）、多区域复制 GA（99.99% SLA）
- LangGraph 1.0 GA（2025-10）；Microsoft Agent Framework 1.0 GA（2026-04，AutoGen + Semantic Kernel 合并）

### 2.2 对照结论

Loong 的设计（FSM+MySQL 过渡 → Temporal；模型提议 / 确定性引擎裁决；Schema + Policy + 幂等 + Saga 四道闸门）**与业界收敛答案同构，属于主流最优路线本身**；四道闸门 ≈ Pipeline + Validation Gates 模式。

### 2.3 差距在进度不在设计

| 项 | 业界 | Loong |
|----|------|-------|
| 耐久执行引擎 | Temporal 实装 + replay 生产验证 | FSM 过渡完成，Temporal 未实装 |
| 状态外置 | 全部外置（Postgres/Redis） | 会话/限流仍在进程内 |
| HITL | LangGraph 单调用 `interrupt()` / Temporal signal | 审批桥已通，但非一等原语 |
| 可观测 | LangSmith trace 级（token/成本/延迟） | console 日志 + /health |

---

## 3. 任务契约（Obligation）与验收

### 3.1 业界痛点：evaluation–enforcement gap

2026 年业界公认结构性缺口：LangSmith / DeepEval / Arize / Braintrust 等评估工具几乎全是**观测层**（LLM-as-judge 打分、看板、告警），**不在执行路径上做运行时强制**（拦截/重试/升级）。"If the quality gate only observes, you're monitoring the failure rate — you're not actually enforcing a floor."

**Loong 的 Obligation 设计恰好是运行时强制层（"契约不过不许 complete"），命中空白，领先半个身位。**

### 3.2 方法学对齐（业界最佳实践）

| 业界共识 | Loong Obligation 设计 |
|---------|----------------------|
| 确定性检查用于精确项（工具名、参数 schema、断言），LLM-as-judge 用于主观项 | 5 类验证器：schema/工具断言/测试命令/人工/模型评审 |
| LLM-as-judge 需人类校准，不可单独定论 | 模型评审只能辅助，不可单独裁定 |
| 六道独立生产门（任务完成率 ≥90%、工具成功率 ≥95%、恢复率 ≥70%、p99 延迟、护栏触发率 1–5%、轨迹质量分 ≥4.0/5），**禁止聚合单一分数掩盖子项失败** | 8 条量化验收独立成项（自证完成率=0、悬挂 100% 有 timer 兜底等） |
| 结果+轨迹双评估（答案对≠路径对） | 证据链覆盖完整执行轨迹 |

### 3.3 差距：评估基础设施

业界有而 Loong 没有：

1. **Golden 数据集**：50–200 条生产 trace 起步，每周评审扩充
2. **三级评测体系**：单元断言 → LLM-as-judge → 线上 5–10% 抽样评测
3. **失败回流机制**：线上失败 trace 自动加入回归集
4. **评测 CI/CD**：PR 级单测 → merge 级 golden 回归（退步 >3% 阻断）→ 部署后金丝雀 + 48–72h 观察

**建议：Obligation 上线后配套建设，作为 Phase 3.x 或独立 eval 基础设施任务。**

---

## 4. 总评与行动清单

| 方案 | 业界对标评级 | 关键行动 |
|------|------------|---------|
| 本体记忆 | B+ → 补三项可到 A | ① 向量召回通道 ② LLM 提取器默认化 ③ LoCoMo/LongMemEval 基准脚本 |
| 确定性编排 | 设计 A / 进度 C+ | 按原计划推进 Temporal 实装与状态外置，不提前不返工 |
| 任务契约 | A（领先半个身位） | 按 Phase 3.0 开工；配套 golden 数据集与三级评测体系 |

**优先级修正建议**（已确认）：

1. Obligation Phase 3.0 按计划开工（差异化最强，设计无需调整）
2. 记忆层补向量召回 + LLM 提取器（接口已预留，增量非返工）
3. 记忆层补 LoCoMo/LongMemEval 评测（对外可信度的前提）
4. Temporal 实装保持原路线

---

## 附录：调研出处

**记忆系统**

- arxiv.org/pdf/2603.04740 — 五大记忆系统架构综述（Mem0/Letta/Zep/MemOS/Mastra）与隐含假设表
- arxiv.org/pdf/2603.17244 — 记忆系统定位对比（Graphiti bitemporal、MAGMA 四图层、belief revision）
- arxiv.org/pdf/2603.14588 — Mem0/MemGPT/Zep/Cognee/SimpleMem 架构与 LoCoMo 数据
- preuve.ai/blog/ai-memory-systems-statistics-2026（2026-07-17）— Mem0/Letta/Zep 采用度与基准数据
- evermind.ai/zh/blogs/best-open-source-agent-memory-frameworks-2026（2026-06-30）— 开源记忆框架对比
- alignify.co/blog/agent-memory（2026-06-20）— 记忆层选型指南
- digitalapplied.com/blog/ai-agent-memory-vector-graph-episodic-2026（2026-05-24）— KG/情景记忆选型
- thedatapraxis.com/blog/knowledge-graphs-for-ai-agents（2026-06-19）— 生产记忆框架架构赌注
- callsphere.ai/blog（2026-07-05）— Letta 2026 现状
- github.com/Uranid/mnem（2026-05-21）— 记忆层对比矩阵（mem0 v2 移除图后端等事实）

**编排**

- zylos.ai/research/2026-04-14-graph-based-agent-workflow-orchestration-production — 2026 图编排格局、五大生产模式、Temporal 里程碑
- langchain.com/resources/langgraph-vs-temporal（2026-06-06）— LangGraph vs Temporal 官方对比
- docs.temporal.io/develop/python/integrations/langgraph — Temporal × LangGraph 官方集成
- spheron.network/blog（2026-06-03）— Temporal/Inngest/Restate 耐久执行对比
- gogloby.com/insights/best-ai-agent-orchestration-platforms-and-frameworks（2026-06-10）— 编排平台榜单
- ecorpit.com/ai-agent-framework-production-langgraph-crewai-microsoft-pydantic-2026（2026-07-19）— 框架选型
- cordum.io/blog/langgraph-vs-temporal-vs-cordum（2026-04-08）— 编排/耐久/治理三层参考架构

**验证与评测**

- waxell.ai/blog/ai-agent-output-validation-production（2026-05-13）— evaluation–enforcement gap
- confident-ai.com/blog/llm-agent-evaluation-complete-guide（2026-06-01）— Agent 评测指标体系（DeepEval）
- testquality.com/how-to-test-ai-agents（2026-05-27）— 三级评测金字塔与六道生产门
- kunalganglani.com/blog/evaluate-ai-agents-production（2026-07-12）— 三级评测框架与 CI/CD 集成
