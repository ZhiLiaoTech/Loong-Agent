# Loong Studio 路由 v1

| 路径 | Nav ID | 页面 | 状态 |
|------|--------|------|------|
| `/` | — | 重定向到 `/chat` | 已实现 |
| `/about` | home | 概览、Gateway 探测 | 已实现 |
| `/chat` | chat | 对话 / Run（`RunWorkspace`） | P3-04 已实现 |
| `/models` | models | 模型提供商配置（`ModelsWorkspace`） | P3-05 已实现 |
| `/agents` | agents | Agent 档案（`AgentsWorkspace`） | P3-06 已实现 |
| `/settings` | settings | Gateway URL、Shared secret | 已实现 |

开发：`pnpm studio:dev` → http://127.0.0.1:1420

Gateway 嵌入 Studio：`pnpm studio:build` 后 `LOONG_UI=studio node packages/cli/dist/index.js gateway` → http://127.0.0.1:17357/

Legacy：`@dragon/gateway-dashboard` 仍为默认嵌入包；见 [gateway-dashboard/README](../packages/gateway-dashboard/README.md)。
