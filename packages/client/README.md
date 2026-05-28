# @dragon/client

TypeScript SDK for Loong Studio and tools: Gateway RPC, SSE events, health checks.

```ts
import { createLoongClient, resolveGatewayUrl } from "@dragon/client";

const { gateway, host } = createLoongClient({
  getSecret: () => process.env.DRAGON_GATEWAY_SECRET ?? "",
});
```
