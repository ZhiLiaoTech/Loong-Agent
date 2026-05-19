# @dragon/skills 技术方案

## 1. 职责边界

**负责**：发现与解析 `SKILL.md`、加载 `references/`、提供 `skill_list` / `skill_load` / `skill_create` / `skill_improve` 工具；CLI `/skills` 斜杠命令共用同一 runtime。

**不负责**：模型 Provider、Gateway。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `createFileSkillRuntime` / `FileSkillRuntime` | 文件系统技能运行时 |
| `createSkillTools` | 四个工具工厂 |
| `SkillSummary` / `LoadedSkill` | 发现与加载结果类型 |

## 3. 内部设计

### 3.1 发现规则

- 根目录可配置多个；默认深度 5。
- 跳过 `node_modules`、`.git`、`dist` 等。
- 解析 YAML frontmatter + 标题/段落 → name、description、category。

### 3.2 工具权限

| 工具 | permission | 能力 |
|------|------------|------|
| `skill_list` / `skill_load` | allow | read |
| `skill_create` / `skill_improve` | ask | write |

`skill_improve` 追加 `references/improvements.md`，带 TOCTOU/inode/硬链接检查。

### 3.3 可写根

**仅 `roots[0]` 可写**；其余根只读。

### 3.4 依赖

仅 `@dragon/tools`。

## 4. 集成方式

CLI：`createFileSkillRuntime({ roots })` + `createSkillTools`；agent 模式处理 `/skills` 前缀消息短路。

## 5. Code Review

### 5.1 优点

- 与 [SKILLS.md](../SKILLS.md) 渐进披露一致；Hermes 式可审计文件技能。
- 写路径安全（realpath、拒绝 symlink 写）。
- 错误对外泛化，避免路径泄漏。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P2 | 多根时仅首根可写，易误解 |
| P2 | 技能名大小写不敏感可能碰撞 |
| P2 | `skill_create` mkdir 非原子，存在竞态 |
| P3 | 单文件 ~1277 行 |

### 5.3 改进建议

1. 配置显式 `writableRoot` 而非隐式 `roots[0]`。
2. 冲突时返回明确错误列表。
3. 解析器独立模块 + 单元测试 fixtures。
