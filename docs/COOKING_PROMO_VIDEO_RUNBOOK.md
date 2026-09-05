# 自动炒菜机视频 Suite 生产故障处理手册

更新时间：2026-09-05

## 通用步骤

1. 确认告警窗口、tenant/job/task id，不在工单或聊天中粘贴预签名 URL、密钥或媒体内容。
2. 先停止扩大影响：暂停新入队或对应角色扩容，禁止直接删除任务文件。
3. 保存健康快照、Worker 日志、任务 JSON、作业 state/events 和容器版本。
4. 按下列条目处理；恢复后观察两个完整窗口，并记录时间线、根因和预防动作。

## api-availability

- 检查 Gateway `/health`、共享密钥/TLS、依赖存储和限流；确认是 5xx 而非客户端 4xx。
- unhealthy 时摘除异常实例，回滚最近 API 版本；不得绕过鉴权恢复流量。

## job-success-rate

- 按 errorCode、阶段、素材来源和版本聚合失败，抽查失败作业 state/events。
- 同版本集中失败则暂停发布并回滚；素材问题进入 dead letter，不做无限重试。

## job-latency

- 区分排队、媒体、模型、渲染耗时，检查 CPU、内存、磁盘 IOPS 和供应商延迟。
- 优先扩容瓶颈角色；禁止通过关闭质检或缩短完整性校验来降时延。

## queue-backlog

- 比较各角色 queue depth、最老任务和心跳；先恢复消费者，再按租约规则接管。
- 检查 idempotency key，避免人工重复入队；积压消退后再恢复正常入口流量。

## dead-letter

- 按 errorCode 区分永久输入错误与临时基础设施错误，保留原任务和最后错误。
- 修复根因并人工批准后使用 requeueDeadLetter；同一任务再次入死信立即升级事件。

## model-success-rate

- 检查授权、配额、超时、响应 schema 与预算；必要时切换确定性降级并强制人工审核。
- 不得把未经许可的关键帧切换到其他云模型。

## worker-heartbeat

- 检查 Pod/进程、OOM、磁盘和网络；确认租约过期后再由新 Worker 接管。
- 旧 Worker 恢复后必须使用新任务租约，禁止手工提交迟到结果。

## 恢复验证

- API availability、job/model success rate 回到 SLO，queue oldest age 持续下降，dead letter 不再增长。
- 运行一组 2/3/4 路合成 E2E 和安全回归；涉及镜像时执行 runtime verifier。
- 完成事故复盘并更新告警阈值、测试或本手册；未经验证不得关闭 critical 告警。
