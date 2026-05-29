# Loong / Dragon 数据目录规范

> 关联：`packages/cli/src/dragon-paths.ts`、P0-06、P4-03

## 解析顺序（`resolveDragonDataRoot`）

1. 环境变量 **`DRAGON_DATA_ROOT`**（绝对路径，指向 `.dragon` 目录本身）
2. 从当前工作目录向上查找已存在的 **`.dragon/`** 目录
3. 向上查找含 **`pnpm-workspace.yaml`** 的 monorepo 根，使用 `<root>/.dragon`
4. 回退：**`<cwd>/.dragon`**

辅助函数：`dragonConfigDir()` → `<dataRoot>/config`

## 路径映射

| 场景 | 数据根 | 配置文件示例 |
|------|--------|----------------|
| 开发（monorepo） | `<repo>/.dragon` | `.dragon/config/providers.json` |
| CLI 指定 | `DRAGON_DATA_ROOT` | `$DRAGON_DATA_ROOT/config/agents.json` |
| Windows 桌面（目标） | `%APPDATA%\Loong\data` 或 `%LOCALAPPDATA%\Loong\data` | 同结构 `config/`、`sessions/`、`memory/` |
| macOS 桌面（目标） | `~/Library/Application Support/Loong/data` | 同上 |
| Linux 桌面（目标） | `~/.local/share/Loong/data` | 同上 |

桌面端（P4）Rust `config.rs` 应写入 `DRAGON_DATA_ROOT`，与 Node `dragon-paths.ts` 行为一致。

## 目录布局（`.dragon`）

```
.dragon/
  config/
    providers.json    # model.config.*
    agents.json         # agent.config.*
    tiers.json          # tier.config.*
  sessions/             # 会话持久化（CLI --session-dir 可覆盖）
  memory/               # 记忆候选与存储
  cron/                 # cron jobs 文件
```

## Gateway 与 Studio

- Browser Studio：不管理数据根，仅通过 Gateway RPC 读写配置；Settings 页显示 `configPath`。
- `dragon gateway` 启动日志会打印解析后的 data root 与 config 路径。

## 环境变量

| 变量 | 用途 |
|------|------|
| `DRAGON_DATA_ROOT` | 覆盖 `.dragon` 根目录 |
| `LOONG_UI` / `DRAGON_UI` | Gateway 嵌入 UI：`studio`（默认，若已 build）或 `dashboard` |
