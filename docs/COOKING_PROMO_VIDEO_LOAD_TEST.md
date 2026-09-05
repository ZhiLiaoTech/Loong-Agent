# 自动炒菜机视频 Suite 压测记录

更新时间：2026-09-05

## 运行方式

```bash
corepack pnpm --filter @loong/cooking-video test:load -- --tasks 100 --workers 8 --rounds 1
corepack pnpm --filter @loong/cooking-video test:load -- --tasks 2 --workers 2 --rounds 1 --soak-seconds 10
```

`--soak-seconds` 支持 0～86,400 秒。生产等价环境建议使用 21,600 秒以上，并通过 `LOONG_LOAD_MAX_ERROR_RATE` 设置错误率门槛。

## 本机结果

| 场景 | 完成 | 错误 | 吞吐 | P95 | 最大延迟 | RSS |
|---|---:|---:|---:|---:|---:|---:|
| 100 tasks / 8 workers | 100/100 | 0 | 13.17/s | 1,708.84 ms | 2,236.67 ms | 95,338,496 B |
| 10 秒持续循环 / 2 workers | 168/168 | 0 | 16.69/s | 120.00 ms | 171.60 ms | 93,622,272 B |

首轮 8 Worker 测试出现 Windows 文件独占锁的 `EPERM` 竞争，修复为有界退避和锁清理重试后，同规格复测达到零错误。测试使用无媒体 I/O 的确定性 Worker executor，用于验证队列容量、并发安全和持续运行；视频处理能力需结合真实素材、CPU、磁盘和固定容器镜像另行定标。
