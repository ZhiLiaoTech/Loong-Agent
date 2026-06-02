import { createServer } from "node:http";
import { parseSlackWebhook, parseTelegramWebhook, postGatewayWebhook, toGatewayWebhookPayload, } from "@loong/channels";
export async function runChannelsServe(options) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 17_358;
    const handler = createChannelsServeHandler(options);
    const server = createServer((request, response) => {
        handler(request, response).catch(error => {
            writeJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Channels bridge failed to resolve listening address.");
    }
    const url = `http://${host}:${address.port}`;
    return {
        url,
        async stop() {
            await new Promise((resolve, reject) => {
                server.close(error => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve();
                    }
                });
            });
        },
    };
}
export function createChannelsServeHandler(options) {
    const gatewayUrl = options.gatewayUrl.replace(/\/+$/, "");
    const defaults = options.defaults;
    return async function handleChannelsRequest(request, response) {
        const method = request.method ?? "GET";
        const url = new URL(request.url ?? "/", "http://localhost");
        if (method === "GET" && url.pathname === "/health") {
            writeJson(response, 200, { ok: true, service: "loong-channels-bridge" });
            return;
        }
        if (method !== "POST") {
            writeJson(response, 405, { ok: false, error: "Method not allowed." });
            return;
        }
        const body = await readRequestBody(request);
        let parsed;
        try {
            parsed = body.trim() ? JSON.parse(body) : {};
        }
        catch {
            writeJson(response, 400, { ok: false, error: "Request body must be JSON." });
            return;
        }
        let message;
        if (url.pathname === "/telegram" || url.pathname === "/webhook/telegram") {
            message = parseTelegramWebhook(parsed);
        }
        else if (url.pathname === "/slack" || url.pathname === "/webhook/slack") {
            message = parseSlackWebhook(parsed);
        }
        else if (url.pathname === "/channels/webhook" || url.pathname === "/webhook") {
            message = parseGenericWebhookPayload(parsed);
        }
        else {
            writeJson(response, 404, { ok: false, error: `Unknown path: ${url.pathname}` });
            return;
        }
        if (message === undefined) {
            writeJson(response, 200, { ok: true, skipped: true, reason: "no_message" });
            return;
        }
        const payload = toGatewayWebhookPayload(message, defaults ?? {});
        const result = await postGatewayWebhook({
            gatewayUrl,
            body: payload,
            ...(options.sharedSecret !== undefined ? { sharedSecret: options.sharedSecret } : {}),
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        writeJson(response, result.ok ? 200 : result.status || 502, {
            ok: result.ok,
            channel: message.channel,
            ...(result.payload !== undefined ? { payload: result.payload } : {}),
            ...(result.error !== undefined ? { error: result.error } : {}),
        });
    };
}
function parseGenericWebhookPayload(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Webhook payload must be a JSON object.");
    }
    const record = parsed;
    if (typeof record.message !== "string" || !record.message.trim()) {
        return undefined;
    }
    const channel = typeof record.channel === "string" && record.channel.trim()
        ? record.channel.trim()
        : "webhook";
    return {
        channel,
        text: record.message.trim(),
        ...(typeof record.userId === "string" ? { userId: record.userId } : {}),
        ...(typeof record.threadId === "string" ? { threadId: record.threadId } : {}),
        ...(isRecord(record.metadata) ? { metadata: record.metadata } : {}),
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readRequestBody(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
function writeJson(response, status, body) {
    const payload = `${JSON.stringify(body)}\n`;
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(payload);
}
export async function parseChannelsServeArgs(args) {
    let host = process.env.LOONG_CHANNELS_HOST?.trim() || "127.0.0.1";
    let port = parseOptionalPort(process.env.LOONG_CHANNELS_PORT) ?? 17_358;
    let gatewayUrl = process.env.LOONG_GATEWAY_URL?.trim()
        || process.env.LOONG_CHANNELS_GATEWAY_URL?.trim()
        || "http://127.0.0.1:17357";
    let sharedSecret = process.env.LOONG_GATEWAY_SECRET?.trim()
        || process.env.LOONG_CHANNELS_GATEWAY_SECRET?.trim();
    let profileId = process.env.LOONG_AGENT_PROFILE?.trim();
    let workspace = process.env.LOONG_WORKSPACE?.trim();
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--host") {
            host = args[index + 1]?.trim() ?? host;
            index += 1;
            continue;
        }
        if (arg?.startsWith("--host=")) {
            host = arg.slice("--host=".length).trim();
            continue;
        }
        if (arg === "--port") {
            port = parsePortArg(args[index + 1], "--port");
            index += 1;
            continue;
        }
        if (arg?.startsWith("--port=")) {
            port = parsePortArg(arg.slice("--port=".length), "--port");
            continue;
        }
        if (arg === "--gateway-url") {
            gatewayUrl = args[index + 1]?.trim() ?? gatewayUrl;
            index += 1;
            continue;
        }
        if (arg?.startsWith("--gateway-url=")) {
            gatewayUrl = arg.slice("--gateway-url=".length).trim();
            continue;
        }
        if (arg === "--secret") {
            sharedSecret = args[index + 1]?.trim();
            index += 1;
            continue;
        }
        if (arg?.startsWith("--secret=")) {
            sharedSecret = arg.slice("--secret=".length).trim();
            continue;
        }
        if (arg === "--profile") {
            profileId = args[index + 1]?.trim();
            index += 1;
            continue;
        }
        if (arg?.startsWith("--profile=")) {
            profileId = arg.slice("--profile=".length).trim();
            continue;
        }
        if (arg === "--workspace") {
            workspace = args[index + 1]?.trim();
            index += 1;
            continue;
        }
        if (arg?.startsWith("--workspace=")) {
            workspace = arg.slice("--workspace=".length).trim();
            continue;
        }
        throw new Error(`Unknown channels option: ${arg}`);
    }
    const defaults = {};
    if (profileId) {
        defaults.profileId = profileId;
    }
    if (workspace) {
        defaults.workspace = workspace;
    }
    return {
        host,
        port,
        gatewayUrl,
        ...(sharedSecret ? { sharedSecret } : {}),
        ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
    };
}
function parsePortArg(value, label) {
    if (!value?.trim()) {
        throw new Error(`Usage: loong channels serve ${label} <port>`);
    }
    return parsePort(value.trim());
}
function parsePort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid port: ${value}`);
    }
    return port;
}
function parseOptionalPort(value) {
    if (!value?.trim()) {
        return undefined;
    }
    return parsePort(value.trim());
}
//# sourceMappingURL=channels-serve.js.map