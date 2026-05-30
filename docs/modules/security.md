# @loong/security 技术方案

## 1. 职责边界

**负责**：敏感字段名识别、文本与 JSON 值中的密钥/令牌脱敏，供 Provider 错误、CLI 输出、Core 权限事件摘要使用。

**不负责**：加密存储、密钥管理、传输层 TLS。

## 2. 对外 API

| 符号 | 说明 |
|------|------|
| `DEFAULT_REDACTION` | 默认替换串 `[REDACTED]` |
| `isSensitiveKey(key)` | 字段名是否敏感 |
| `redactSecretsInText(value, options?)` | 正则替换文本中密钥模式 |
| `redactSensitiveJsonValue(key, value, replacement?)` | 按 key 脱敏 JSON 值 |

## 3. 内部设计

### 3.1 isSensitiveKey

匹配 token、secret、api_key、password、credential、authorization 等；**独立单词 `key` 也会命中**（可能过度脱敏）。

### 3.2 redactSecretsInText 模式（概念）

- JSON `"key": "value"` 形式
- `key=value`、Bearer token
- `sk-…` OpenAI 风格
- URL 凭证、query string 中的 secret 参数

纯函数、无状态。

## 4. 集成方式

| 消费者 | 用途 |
|--------|------|
| `@loong/providers` | `sanitizeProviderBody` |
| `@loong/core` | 权限/工具事件摘要 |
| `@loong/cli` | 元数据输出 |

## 5. Code Review

### 5.1 优点

- 极小依赖面，任意层可安全引用。
- 统一 redaction 策略，避免各包自写不完整正则。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P2 | 正则无法覆盖 JWT、任意 base64、自定义头 |
| P2 | `key` 字段误杀合法业务字段 |
| P3 | 截断可能留下可识别前缀 |
| P3 | 无结构化 JSON 深度遍历 |

### 5.3 改进建议

1. 增加 `walkAndRedactJson(obj, depth)` 供 Provider 错误体使用。
2. `isSensitiveKey` 对单独 `key` 改为需后缀或上下文（如 `api_key`）。
3. 文档列出已覆盖与未覆盖格式；test-suite 已有部分用例可扩展。
