# HEARTBEAT — 定时调度器

> OpenClaw 每 5 分钟触发一次 HEARTBEAT，本文件定义调度逻辑。

## 执行流程

1. 读取 `crons.json` 获取任务定义
2. 读取 `data/scheduler-state.json` 获取上次执行状态（不存在则初始化为 `{}`）
3. 获取当前北京时间（UTC+8）
4. 遍历 `crons.json` 中的 `crons[]`，判断哪些任务到期
5. 若有到期任务，执行优先级最高的**一个**（按数组顺序）
6. 执行前在 `scheduler-state.json` 中标记 `running`
7. 执行完成后更新 `last_run` 时间戳

## 约束

- 每次 HEARTBEAT 最多执行 1 个到期任务
- 执行时间上限 60 秒
- `scheduler-state.json` 只由 HEARTBEAT 机制修改
- 补跑策略由 `crons.json` 的 `catch_up_policy` 控制

## 状态文件格式

```json
{
  "task-id": {
    "last_run": "2026-03-16T08:00:00+08:00",
    "status": "completed"
  }
}
```
