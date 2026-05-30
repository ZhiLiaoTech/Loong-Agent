# @loong/plugin-sdk 技术方案

## 1. 职责边界

**负责**：读取 `loong.plugin.json`、安全加载插件 ESM 入口、在 `activate()` 期间收集 tools/providers/hooks/memory backends、规范化并冻结注册项。

**不负责**：运行 Agent 回合、持久化配置。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `loadLoongPlugin(root, options?)` | 返回 `LoadedLoongPlugin` |
| `LoongPlugin` / `LoongPluginManifest` | 插件契约 |
| `LoongPluginContext` | `registerTool`、`registerProvider`、`registerLifecycleHook`、`registerMemoryBackend` |

## 3. 内部设计

### 3.1 加载流程

```text
realpath(pluginRoot)
  → 读 manifest (≤64KB)
  → 校验 entry 路径不逃逸
  → dynamic import(.js|.mjs only)
  → activate(context) — 注册窗口
  → freeze 所有注册项
  → 返回 LoadedLoongPlugin { deactivate? }
```

### 3.2 限额

| 资源 | 上限 |
|------|------|
| tools | 100 |
| providers | 40 |
| hooks | 40 |
| memory backends | 20 |

保留 id：`file`、`sqlite`（内置记忆后端）。

### 3.3 校验

- Tool：`inputSchema` JSON 深度/大小/循环引用限制
- Provider：经 `normalizeProviderModelEntries`
- Memory：记录 content/metadata 边界（CLI 层再次校验）

### 3.4 依赖

`core`、`memory`、`model-catalog`、`tools`、`providers`（类型与规范化）。

## 4. 集成方式

CLI `loadConfiguredPlugins()` → 合并到 runtime 的 registry / hooks / memory backend 选择。

## 5. Code Review

### 5.1 优点

- 路径穿越防护完善。
- 注册期关闭窗口，防止 activate 后动态加工具。
- activate 失败尝试 `deactivate` 清理。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | 仅支持编译后 `.js`，TS 插件必须 pre-build |
| P1 | 无 `loongVersion` 兼容性检查 |
| P1 | 插件与主进程同权，无隔离 |
| P2 | 单文件 ~520 行，无子路径导出给作者 |
| P3 | CPU 密集 hook 无法抢占（文档已说明） |

### 5.3 改进建议

1. 开发模式可选 `tsx` loader 或 `loong plugin build` 脚手架。
2. Manifest 增加 `engines.loong` semver 范围。
3. 长期：Worker 子进程跑 hook 或工具沙箱（与 [PLUGINS.md](../PLUGINS.md) 路线图一致）。
