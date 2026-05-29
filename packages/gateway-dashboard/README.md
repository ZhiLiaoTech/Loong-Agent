# @dragon/gateway-dashboard

> **Deprecation:** New UI work belongs in [`@dragon/studio`](../studio/README.md).  
> Use `pnpm studio:dev` for daily development.

| 里程碑 | 日期 |
|--------|------|
| Studio 功能对等（Chat/Models/Agents） | 2026-05-28 ✓ |
| Gateway 默认 embed Studio（`studio/dist` 存在时） | 2026-05-28 ✓ |
| **退役独立 dashboard 入口** | **2026-08-31** |

After **2026-08-31**, this package remains buildable for smoke tests only; `GET /` serves `@dragon/studio` exclusively.

## Preferred: Loong Studio

| | Studio | gateway-dashboard (this package) |
|---|--------|----------------------------------|
| Dev | `pnpm studio:dev` → :1420 | `pnpm --filter @dragon/gateway-dashboard dev` |
| Routes | Browser history `/chat` … | Hash `#/run` … |
| Gateway embed | **default** when `studio/dist` exists | `LOONG_UI=dashboard` |

## 双入口（legacy）

| 入口 | URL | 说明 |
|------|-----|------|
| **Legacy** | `http://127.0.0.1:17357/?ui=legacy` | `src/legacy-app.js` |
| **V2 React** | `http://127.0.0.1:17357/?ui=v2#/run` | Hash 路由 |

## 开发 / 构建

```bash
corepack pnpm --filter @dragon/gateway-dashboard dev
corepack pnpm --filter @dragon/gateway-dashboard build
```

`@dragon/gateway` 在 `LOONG_UI=dashboard` 时读取 `dist/index.html`（内联单文件 HTML）。

## 认证

V2 使用 `SecretProvider` + sessionStorage key `dragon.gateway.secret`（与 Studio 对齐）。

## 测试

```bash
corepack pnpm --filter @dragon/test-suite test
```

Dashboard legacy 字符串断言在 `testDashboardMemoryReviewSmoke`（强制 `LOONG_UI=dashboard`）。
