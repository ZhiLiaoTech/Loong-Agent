# @loong/providers 技术方案

## 1. 职责边界

**负责**：`ModelProvider` 契约、Provider 注册与模型引用解析、OpenAI Chat Completions 与 Anthropic Messages API 适配、SSE 流式解析、Provider 错误脱敏。

**不负责**：工具实现、会话存储、全局 Model Catalog 聚合（部分在 model-catalog，但未强制使用）。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `ModelProvider` | `complete(request)`、可选 `canHandleModel`、`models` |
| `ProviderRegistry` / `createProviderRegistry` | 注册与 `resolve(modelRef)` |
| `createOpenAICompatibleProvider(…)` | OpenAI 兼容 HTTP |
| `createAnthropicProvider(…)` | Anthropic Messages |
| `create*FromEnv()` | 环境变量快捷构造 |
| `ProviderError` | 含 `retryable`、`sanitizeProviderBody` |

## 3. 内部设计

### 3.1 模型引用解析

支持形式：

- `provider:model` / `provider/model`
- 裸 model id：遍历 `canHandleModel`，**先注册者优先**

与 [model-catalog](../model-catalog.md) 的关系：Provider 注册时用 `normalizeProviderModelEntries` 规范化 `models[]`；**Registry 不调用 `LoongModelCatalog.resolve()`**。

### 3.2 流式

`onTextDelta` 回调存在时请求 `stream: true`；SSE 由 `sse.ts` 统一解析；工具调用增量在 OpenAI/Anthropic 适配层分别组装。

### 3.3 环境变量

| Provider | 变量链 |
|----------|--------|
| OpenAI | `LOONG_OPENAI_*` → `OPENAI_*` |
| Anthropic | `LOONG_ANTHROPIC_*` → `ANTHROPIC_*` |

### 3.4 依赖

- `@loong/model-catalog` — 模型条目规范化
- `@loong/security` — `sanitizeProviderBody`

## 4. 集成方式

CLI：`createBuiltinProviders()` + 插件 `registerProvider` → `createProviderRegistry` → `createLoongRuntime({ providerRegistry })`。

Gateway：`providers.list` RPC 读取 registry 元数据。

## 5. Code Review

### 5.1 优点

- 双 Provider 适配清晰，工具调用与流式均覆盖。
- `ProviderError.retryable` 与 core fallback 配合良好。
- 错误体经 security 脱敏再抛出/记录。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | 裸 model 多 Provider 匹配时行为隐式 |
| P1 | 全局 ModelCatalog 未接入生产路径 |
| P2 | 工具 schema 原样透传 HTTP，无校验 |
| P2 | 包内无自动重试，仅标记 retryable |
| P2 | 流式 tool JSON 不完整时错误发现晚 |
| P3 | `provider/` 空 model 段解析为 invalid |

### 5.3 改进建议

1. CLI 启动构建 `createModelCatalog` 作为 resolve 唯一入口。
2. 多 match 时要求显式 `provider:` 前缀或报错。
3. 可选重试包装器（指数退避，仅 retryable）。
4. 为 SSE 解析与 tool delta 增加 fixture 单测。
