# @dragon/model-catalog 技术方案

## 1. 职责边界

**负责**：Provider 级模型目录条目的规范化、校验、冻结；`provider:model` / `provider/model` 解析；从 Provider 列表生成目录快照。

**不负责**：HTTP 调用、运行时模型选择（应由 Registry + Catalog 协同，当前未完全协同）。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `DragonModelCatalog` / `createModelCatalog` | 全局目录注册表 |
| `DragonModelCatalogEntry` | 单条模型元数据 |
| `normalizeProviderModelEntries` | Provider 注册时规范化 |
| `catalogEntriesFromProviders` | 从 Provider 数组生成条目 |
| `createModelCatalogFromProviders` | 从 Provider 源构建 Catalog 实例 |
| `applyModelCatalogToParams` | 将裸别名规范为 `provider:model`（Gateway/CLI 共用） |

能力标志：`toolCalling`、`streaming`、`vision`、`reasoning`、`jsonMode` 等。

## 3. 内部设计

### 3.1 存储键

`catalogKey(providerId, modelId)` → `providerId + NUL + modelId`。

### 3.2 resolve(modelRef)

1. 含 `/` 或 `:` → 拆分为 provider + model。
2. 裸 id → 全局唯一匹配才返回；0 或 >1 匹配 → `undefined`。

### 3.3 规范化约束（节选）

- id 最长 200 字符
- 别名最多 20 个
- 控制字符拒绝
- 条目 `Object.freeze`

### 3.4 依赖

无 workspace 依赖。

## 4. 集成方式

- **已用**：`@dragon/providers` Registry 注入 `modelCatalog` 做 `resolve`；Gateway `#resolveAgentParams` 与 CLI `runTurn` 前调用 `applyModelCatalogToParams`；`createModelCatalogFromProviders` 由 Gateway provider summaries 构建。

## 5. Code Review

### 5.1 优点

- 边界校验严格，防止插件/配置注入畸形元数据。
- 不可变条目减少运行时意外修改。
- 与 Provider 解耦，适合 Dashboard 统一展示。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | 全局 Catalog 未接入生产 resolve 路径 |
| P2 | 裸 ref 静默失败（undefined）不利于 UI 报错 |
| P2 | `/` 与 `:` 混用模型 id 时 `findProviderSeparator` 取最早分隔符 |
| P3 | Gateway 部分 capability 逻辑与 catalog 重复 |

### 5.3 改进建议

1. CLI 启动：`catalog = createModelCatalog(catalogEntriesFromProviders(registry))`。
2. `providers.list` / Dashboard 改读 Catalog 而非逐 Provider 拼接。
3. 歧义 resolve 返回结构化错误 `{ code: "ambiguous_model_ref", candidates: [...] }`。
