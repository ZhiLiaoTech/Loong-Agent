# 自动炒菜机视频 Suite 安全测试

更新时间：2026-09-05

| 风险 | 防护 | 自动化结果 |
|---|---|---|
| 本地路径穿越 | approved root + realpath 校验，拒绝 `..` 和符号链接逃逸 | 通过 |
| 对象 key 穿越 | tenant/job/asset 安全 ID + base filename | 通过 |
| 恶意媒体元数据 | ffprobe 输出、流数、分辨率、帧率、时长硬上限 | 通过 |
| 命令注入 | `spawn(command, args, {shell:false})`，元字符仅作为普通参数 | 通过 |
| 工具输出耗尽内存 | stdout+stderr 总量上限，超限终止子进程 | 通过 |
| 跨租户/跨用户访问 | trusted principal、tenant/owner/role 三重校验、统一不可访问响应 | 通过 |
| 过期 Worker 覆盖 | worker id + 随机 lease token + 到期校验 | 通过 |
| 非法下载链接 | 仅已完成对象、HTTPS、有限过期窗口 | 通过 |

执行命令：

```bash
corepack pnpm --filter @loong/cooking-video test
```

当前共 59 项通过，其中 4 项位于独立 `security.test.mjs`，其余隔离与授权用例与对应功能放在同一集成测试中。Review 期间补充了 ffprobe 恶意尺寸、超高帧率、超长时长和过多流限制。
