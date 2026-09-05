# 自动炒菜机视频 Suite 生产部署手册

## 1. 前置条件

- Linux x86_64/arm64 构建机，Docker/BuildKit；生产节点可访问对象存储、模型服务和持久队列卷。
- Gateway 必须启用 TLS 终止和 shared-secret/上游身份验证，不能以 `authMode=none` 对外。
- `/data/jobs`、`/data/queue`、审计目录分别持久化并备份；密钥只通过 Secret 注入。

## 2. 构建与验证

```bash
git checkout <approved-tag>
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @loong/cooking-video test
corepack pnpm --filter @loong/cooking-video test:load -- --tasks 100 --workers 8 --rounds 1
docker build -f deploy/cooking-video/Dockerfile -t registry.example/loong/cooking-video-worker:<version> .
docker run --rm registry.example/loong/cooking-video-worker:<version> node deploy/cooking-video/verify-runtime.mjs
```

镜像按 digest 发布和部署，不复用 `latest`。发布前还要执行真实 2/3/4 路 E2E、安全回归和镜像内 Chromium 渲染。

## 3. 进程与存储

- Gateway/API：身份、上传/下载签名、审核、入队和状态查询。
- media Worker：`ingest/sync`；model Worker：`detect/select/edit`；render Worker：`render/validate`。
- 所有 Worker 只挂载所需 Secret；共享作业/队列存储或使用等价数据库队列适配器。
- 对象 key 必须保持 `tenant/job/asset/file` 隔离；原片不经过 Gateway。

one-shot Worker 环境变量：

```text
LOONG_COOKING_VIDEO_WORKER_ROLE=media|model|render
LOONG_COOKING_VIDEO_JOBS_ROOT=/data/jobs
LOONG_COOKING_VIDEO_QUEUE_ROOT=/data/queue
```

由编排器持续拉起 `loong-cooking-video-worker --worker-id <stable-instance-id>`；idle 退出码为 0。

## 4. 发布步骤

1. 备份配置、队列、作业状态、审计索引；记录当前镜像 digest。
2. 先部署一个 canary Worker，各角色完成一项合成任务。
3. 滚动更新 Worker，再更新 API；禁止同时运行不兼容 schema 的版本。
4. 验证健康快照、队列最老年龄、死信、成功率、P95 和对象完整性。
5. 观察两个告警窗口后完成发布记录。

## 5. 备份与恢复

- 每日备份 job/state/edit/analysis、queue/tasks 和审计；原片/成片使用对象存储版本控制或跨区复制。
- 每季度做恢复演练：恢复到隔离命名空间，校验任务摘要、对象 SHA-256 和审核记录。
- 不从备份恢复已过期预签名 URL或 lease token；恢复队列后等待旧租约到期再接管。

## 6. 故障与回滚

告警按 [生产故障处理手册](./COOKING_PROMO_VIDEO_RUNBOOK.md) 处置。回滚使用上一镜像 digest 和对应代码/配置；若发生 schema 迁移，必须先按[版本升级与回滚](./COOKING_PROMO_VIDEO_UPGRADE.md)执行兼容性判断，禁止直接覆盖数据目录。客户日常投递和审核步骤见[客户操作手册](./COOKING_PROMO_VIDEO_CUSTOMER_OPERATIONS.md)。
