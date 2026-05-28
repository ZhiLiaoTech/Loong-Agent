# @dragon/gateway-dashboard

> **Deprecation:** New UI work belongs in [`@dragon/studio`](../studio/README.md).  
> Use `pnpm studio:dev` for daily development. This package remains for Legacy/V2 hash routes, smoke tests, and Gateway embed fallback until P3-10 sunset.

Gateway 内嵌 Dashboard 前端：**Vite + React 19**，构建产物由 `@dragon/gateway` 在 `GET /` / `GET /dashboard` 提供（默认 `LOONG_UI=dashboard`）。

## Preferred: Loong Studio

| | Studio | gateway-dashboard (this package) |
|---|--------|----------------------------------|
| Dev | `pnpm studio:dev` → :1420 | `pnpm --filter @dragon/gateway-dashboard dev` |
| Routes | Browser history `/chat` … | Hash `#/run` … |
| Shell | `@dragon/ui` Sidebar | V2 AppShell |
| Gateway embed | `LOONG_UI=studio` + `studio build` | default |

## 双入口（legacy）

| 入口 | URL | 说明 |
|------|-----|------|
| **Legacy**（默认） | `http://127.0.0.1:17357/` | `src/legacy-app.js` + `styles-legacy.css` |
| **V2 React** | `http://127.0.0.1:17357/?ui=v2#/run` | Hash 路由 |

切换：查询参数 `?ui=v2` 由 `src/main.ts` 决定挂载 `#root`（React）或 `.app`（Legacy）。

## 开发

```bash
corepack pnpm --filter @dragon/gateway-dashboard dev
```

## 构建

```bash
corepack pnpm --filter @dragon/gateway-dashboard build
```

`@dragon/gateway` 通过 `dashboard-static.ts` 读取 `dist/index.html`（内联单文件 HTML）。

## 认证

V2 使用 `SecretProvider` + sessionStorage key `dragon.gateway.secret`（与 Studio 对齐）。

## 测试

```bash
corepack pnpm --filter @dragon/test-suite test
```

Smoke tests expect the **dashboard** bundle strings by default; Studio uses a separate build.
