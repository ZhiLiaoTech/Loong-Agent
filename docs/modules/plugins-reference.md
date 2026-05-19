# 参考插件（plugin-*）技术方案

本文档覆盖 workspace 内四个参考插件包，均通过 `dragon.plugin.json` + `dist/index.js` 加载。

## 1. 共同模式

```text
dragon.plugin.json → loadDragonPlugin → activate(context)
  → registerProvider | registerTool
```

| 约束 | 说明 |
|------|------|
| 构建 | 必须先 `pnpm --filter @dragon/plugin-* build` |
| 无密钥 | Provider 插件在无 API Key 时 **静默不注册** |
| 权限 | Git 工具 `permission: "allow"`，只读 |

---

## 2. @dragon/plugin-openai-compatible

**路径**：`packages/plugin-openai-compatible/`

| 项 | 内容 |
|----|------|
| 注册 | OpenAI Chat Completions Provider |
| 环境变量 | `DRAGON_PLUGIN_OPENAI_*` → `DRAGON_OPENAI_*` → `OPENAI_*` |
| 默认模型 | `gpt-4.1-mini` |
| 实现 | 复用 `@dragon/providers` `createOpenAICompatibleProvider` |

**Review**：与 CLI 内置 `createOpenAICompatibleProviderFromEnv` 功能重叠；适合作为插件作者示例。

---

## 3. @dragon/plugin-anthropic-compatible

**路径**：`packages/plugin-anthropic-compatible/`

| 项 | 内容 |
|----|------|
| 注册 | Anthropic Messages Provider |
| 环境变量 | `DRAGON_PLUGIN_ANTHROPIC_*` → `DRAGON_ANTHROPIC_*` → `ANTHROPIC_*` |
| 默认模型 | `claude-3-5-haiku-latest` |
| 特性 | 可选 `maxTokens`、`apiVersion`；工具调用翻译 |

**Review**：生产环境更常用 CLI 内置 Anthropic；插件演示 Messages API 集成。

---

## 4. @dragon/plugin-openrouter-compatible

**路径**：`packages/plugin-openrouter-compatible/`

| 项 | 内容 |
|----|------|
| 注册 | OpenRouter（OpenAI 兼容客户端） |
| 环境变量 | `DRAGON_OPENROUTER_*` / `OPENROUTER_*`（**无** `DRAGON_PLUGIN_` 前缀） |
| 默认 URL | `https://openrouter.ai/api/v1` |
| 头 | `HTTP-Referer`、`X-OpenRouter-Title`（归因） |

**Review**：环境变量命名与其他 plugin 不一致，文档需突出；适合多模型聚合场景。

---

## 5. @dragon/plugin-git-tools

**路径**：`packages/plugin-git-tools/`

| 工具 | 说明 |
|------|------|
| `git_status` | 工作区状态 |
| `git_diff` | 差异 |
| `git_log` | 提交历史 |

**安全**：`spawn("git", argv)` 无 shell；清理危险 `GIT_*`；禁用 pager/diff 外部命令；10s 超时；64k 输出上限；路径 filter 拒绝 `..` 与绝对路径。

**Review**：

- 优点：Gateway `tool.invoke` 默认白名单与此一致。
- 问题：非零 exit 仍 `ok: true`，调用方需读 `exitCode`；依赖系统 `git` 可执行文件。

---

## 6. 加载示例

```bash
corepack pnpm --filter @dragon/plugin-git-tools build
dragon agent --plugin-root packages/plugin-git-tools "summarize recent commits"
dragon gateway --plugin-root packages/plugin-openai-compatible --secret "$DRAGON_GATEWAY_SECRET"
```

详见 [PLUGINS.md](../PLUGINS.md)。
