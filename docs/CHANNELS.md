# Loong Channels Bridge

Loong can receive Telegram and Slack webhooks through a lightweight local bridge, then forward normalized messages to the Gateway `POST /channels/webhook` endpoint.

## Topology

```text
Telegram / Slack  →  loong channels serve  →  loong gateway  →  agent runtime
     (HTTPS)            (127.0.0.1:17358)        (127.0.0.1:17357)
```

Run **both** processes on the same machine (or ensure the bridge can reach the Gateway URL).

## Quick start

```bash
# Terminal 1
loong gateway --secret my-secret

# Terminal 2
loong channels serve --gateway-url http://127.0.0.1:17357 --secret my-secret
```

Point your messenger webhook to:

| Provider | Bridge URL |
|----------|------------|
| Telegram | `http://<host>:17358/telegram` |
| Slack | `http://<host>:17358/slack` |
| Generic JSON | `http://<host>:17358/channels/webhook` |

Health check: `GET http://127.0.0.1:17358/health`

## CLI options

```bash
loong channels serve \
  --host 127.0.0.1 \
  --port 17358 \
  --gateway-url http://127.0.0.1:17357 \
  --secret <gateway-shared-secret> \
  --profile <agents.json profile id> \
  --workspace <path>
```

Environment variables:

- `LOONG_CHANNELS_HOST`, `LOONG_CHANNELS_PORT`
- `LOONG_GATEWAY_URL` or `LOONG_CHANNELS_GATEWAY_URL`
- `LOONG_GATEWAY_SECRET`
- `LOONG_AGENT_PROFILE`, `LOONG_WORKSPACE`

## Production notes

- Put TLS termination in front of the bridge (reverse proxy or tunnel).
- Use the same `shared-secret` as the Gateway.
- For internet-facing Telegram, use a public HTTPS URL that forwards to the bridge port.
