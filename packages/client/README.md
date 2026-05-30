# @loong/client

TypeScript SDK for Loong Studio and tools: Gateway RPC, SSE events, health checks.

```ts
import { createLoongClient, resolveGatewayUrl } from "@loong/client";

const { gateway, host } = createLoongClient({
  getSecret: () => process.env.LOONG_GATEWAY_SECRET ?? "",
});
```
