# Dragon Deployment

Dragon currently supports local deployment testing through the CLI Gateway and
Docker Compose.

## Local Smoke Test

Build the workspace and start a temporary Gateway:

```bash
corepack pnpm build
corepack pnpm smoke:gateway
```

To test an already running Gateway:

```bash
DRAGON_SMOKE_GATEWAY_URL=http://127.0.0.1:8787 DRAGON_GATEWAY_SECRET=test corepack pnpm smoke:gateway
```

PowerShell:

```powershell
$env:DRAGON_SMOKE_GATEWAY_URL = "http://127.0.0.1:8787"
$env:DRAGON_GATEWAY_SECRET = "test"
corepack pnpm smoke:gateway
```

## Docker Compose

Create a local `.env` from `.env.example`, then run:

```bash
docker compose up --build
```

The Gateway dashboard is available at:

```text
http://127.0.0.1:8787
```

Runtime endpoints such as `/health`, `/rpc`, `/events`, and `/ws` require the
shared secret when `DRAGON_GATEWAY_SECRET` is configured.

## Production Notes

This is a deployment-test profile, not a hardened production chart. Before
production use, add TLS termination, secret management, image publishing,
resource limits, log retention, backup policy for `/data`, and live model
provider smoke checks.
