# 自动炒菜机视频 Suite 版本升级与回滚

## 当前基线

- Suite/核心包：`0.1.0`
- 作业、artifact、上传会话、队列和审计 schema：`1.0`
- Worker 镜像运行时版本由 `deploy/cooking-video/Dockerfile` 与 `verify-runtime.mjs` 固定。

## 升级前

1. 阅读 release notes，确认 schema、环境变量、对象 key 和模型协议变化。
2. 备份作业、队列、审计、配置并验证恢复；记录旧镜像 digest。
3. 在备份副本运行新版本 check、63+ 单元/集成测试、load、安全与真实媒体 E2E。
4. 确认新 Worker 可读取旧 schema；不兼容变更必须提供幂等、可中断、可审计的迁移器。

## 升级顺序

1. 暂停新入队，等待运行任务完成或租约安全到期。
2. 先 canary media/model/render Worker，再滚动 Worker，最后升级 Gateway/API。
3. 恢复流量后核对 completed/dead-letter 数、P95、模型成功率和质量门禁。
4. 连续两个监控窗口正常后关闭变更单。

## 回滚

- 无数据迁移：暂停入队，恢复上一镜像 digest 与配置，等待新版本租约过期后启动旧 Worker。
- 有向前兼容迁移：旧版本可读时按上述方式回滚应用，不反向改写数据。
- 不可逆迁移：停止写入，从升级前备份恢复到隔离目录，校验摘要后切换；保留故障现场。
- 不得使用 `git reset --hard`、删除 queue/state 或手工修改状态来“修复”生产任务。

## 版本变更检查表

- [ ] lockfile、Node digest、Debian snapshot、FFmpeg/Chromium/字体验证同步更新。
- [ ] schema 兼容性、迁移和回滚演练通过。
- [ ] 对象上传/下载签名、租户隔离和审计回归通过。
- [ ] 2/3/4 路 E2E、质量门禁、安全与负载测试通过。
- [ ] 部署手册、客户手册、Runbook、SLO 和 release notes 已更新。
