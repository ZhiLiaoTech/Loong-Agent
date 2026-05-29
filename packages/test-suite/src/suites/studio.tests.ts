import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGatewayClient } from "@dragon/client";
import { createHttpGateway, resetDashboardStaticCache } from "@dragon/gateway";
import {
  assert,
  createEventRuntime,
} from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

const require = createRequire(import.meta.url);

function resolveStudioDist(): string {
  const pkgJson = require.resolve("@dragon/studio/package.json");
  return join(dirname(pkgJson), "dist");
}

function readStudioBundleText(): string {
  const dist = resolveStudioDist();
  const indexPath = join(dist, "index.html");
  assert(existsSync(indexPath), "studio dist missing; run: pnpm --filter @dragon/studio build");
  const html = readFileSync(indexPath, "utf8");
  const scriptMatch = html.match(/src="([^"]+\.js)"/);
  if (!scriptMatch?.[1]) {
    return html;
  }
  const scriptPath = join(dist, scriptMatch[1].replace(/^\//, ""));
  const js = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
  return `${html}\n${js}`;
}

async function testStudioBundleSmoke(): Promise<void> {
  const bundle = readStudioBundleText();
  assert(bundle.includes("Loong") || bundle.includes("loong"), "studio bundle should reference Loong branding");
  assert(bundle.includes("dragon.gateway.secret"), "studio bundle should use dragon.gateway.secret storage key");
  assert(bundle.includes("agent.config.get"), "studio bundle should call agent.config.get");
  assert(bundle.includes("model.config.save"), "studio bundle should call model.config.save");
}

async function testStudioClientAgentChat(): Promise<void> {
  const runtime = createEventRuntime();
  const gateway = createHttpGateway({ runtime });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const client = createGatewayClient({
      baseUrl: address.url,
      getSecret: () => "",
    });
    const health = await client.fetchHealth();
    assert(health.ok === true, "studio client health check should succeed");

    const payload = await client.rpc<{
      result: { messages: Array<{ role: string; content: string }> };
    }>("agent", { sessionId: "studio-smoke", message: "hello from studio smoke" });
    const reply = payload.result.messages[1]?.content;
    assert(reply === "ws-ok", `studio client agent chat should round-trip, got ${String(reply)}`);
  } finally {
    await gateway.stop();
  }
}

async function testGatewayServesStudioWhenConfigured(): Promise<void> {
  const dist = resolveStudioDist();
  assert(existsSync(join(dist, "index.html")), "studio dist required for LOONG_UI=studio embed test");

  const previous = process.env.LOONG_UI;
  process.env.LOONG_UI = "studio";
  resetDashboardStaticCache();

  const gateway = createHttpGateway({ runtime: createEventRuntime() });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const response = await fetch(address.url);
    const html = await response.text();
    assert(response.status === 200, `expected 200 from gateway /, got ${response.status}`);
    assert(html.includes("Loong Studio"), "gateway with LOONG_UI=studio should serve studio index.html");
  } finally {
    await gateway.stop();
    if (previous === undefined) {
      delete process.env.LOONG_UI;
    } else {
      process.env.LOONG_UI = previous;
    }
    resetDashboardStaticCache();
  }
}

export const studioTestCases: TestCase[] = [
  ["studio bundle smoke", testStudioBundleSmoke],
  ["studio client agent chat", testStudioClientAgentChat],
  ["gateway serves studio embed", testGatewayServesStudioWhenConfigured],
];
