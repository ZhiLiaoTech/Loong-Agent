#!/usr/bin/env node
/**
 * Measure TTFT (time to first token) and total latency for OpenAI-compatible chat APIs.
 *
 * Usage:
 *   node scripts/model-latency-test.mjs
 *   LOONG_LATENCY_API_KEY=... node scripts/model-latency-test.mjs --runs 3
 */

const DEFAULT_API_KEY = process.env.LOONG_LATENCY_API_KEY ?? "";

const ENDPOINTS = [
  { name: "baseUrl1 (clawworks)", baseUrl: "https://www.clawworks.cn/gateway/v1" },
  { name: "baseUrl3 (getopenclaw)", baseUrl: "https://www.getopenclaw.cn/gateway/v1" },
];

const MODEL = process.env.LOONG_LATENCY_MODEL ?? "deepseek-v-pro";
const PROMPT = process.env.LOONG_LATENCY_PROMPT ?? "用一句话介绍你自己，不超过20字。";
const RUNS = parseInt(process.argv.find(a => a.startsWith("--runs="))?.split("=")[1] ?? "2", 10);

function parseArgs() {
  const apiKey = process.argv.includes("--api-key")
    ? process.argv[process.argv.indexOf("--api-key") + 1]
    : DEFAULT_API_KEY;
  return { apiKey };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

async function measureStreamLatency({ name, baseUrl, apiKey, runIndex }) {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const started = performance.now();
  let ttftMs = null;
  let totalChars = 0;
  let chunkCount = 0;
  let finishReason = null;
  let errorText = null;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
      stream: true,
      max_tokens: 128,
      temperature: 0.2,
    }),
  });

  const headersReceivedMs = performance.now() - started;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 400)}`);
  }

  if (!response.body) {
    throw new Error("Response has no body (streaming unsupported?)");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        if (ttftMs === null) {
          ttftMs = performance.now() - started;
        }
        totalChars += delta.length;
        chunkCount += 1;
      }

      const reason = payload.choices?.[0]?.finish_reason;
      if (reason) finishReason = reason;

      const err = payload.error;
      if (err) {
        errorText = typeof err === "string" ? err : JSON.stringify(err);
      }
    }
  }

  const totalMs = performance.now() - started;

  if (errorText) {
    throw new Error(errorText);
  }

  return {
    name,
    baseUrl,
    runIndex,
    headersReceivedMs: round(headersReceivedMs),
    ttftMs: ttftMs === null ? null : round(ttftMs),
    totalMs: round(totalMs),
    chunkCount,
    totalChars,
    finishReason,
  };
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function avg(nums) {
  if (nums.length === 0) return null;
  return round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

async function main() {
  const { apiKey } = parseArgs();
  if (!apiKey) {
    console.error("Missing API key. Set LOONG_LATENCY_API_KEY or pass --api-key <token>");
    process.exit(1);
  }
  console.log("Model latency test");
  console.log("==================");
  console.log(`Model   : ${MODEL}`);
  console.log(`Prompt  : ${PROMPT}`);
  console.log(`Runs    : ${RUNS} per endpoint`);
  console.log("");

  const summary = [];

  for (const endpoint of ENDPOINTS) {
    console.log(`--- ${endpoint.name} ---`);
    console.log(`URL: ${endpoint.baseUrl}/chat/completions`);
    const runs = [];

    for (let i = 1; i <= RUNS; i += 1) {
      try {
        const result = await measureStreamLatency({
          ...endpoint,
          apiKey,
          runIndex: i,
        });
        runs.push(result);
        console.log(
          `  run ${i}: headers=${result.headersReceivedMs}ms | TTFT=${result.ttftMs ?? "N/A"}ms | total=${result.totalMs}ms | chars=${result.totalChars} chunks=${result.chunkCount}`,
        );
      } catch (error) {
        console.log(`  run ${i}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
      }
      // small gap between runs
      if (i < RUNS) await sleep(500);
    }

    const ok = runs.filter(r => r.ttftMs !== null);
    summary.push({
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      successRuns: ok.length,
      totalRuns: RUNS,
      avgHeadersMs: avg(ok.map(r => r.headersReceivedMs)),
      avgTtftMs: avg(ok.map(r => r.ttftMs)),
      avgTotalMs: avg(ok.map(r => r.totalMs)),
      minTtftMs: ok.length ? Math.min(...ok.map(r => r.ttftMs)) : null,
      maxTtftMs: ok.length ? Math.max(...ok.map(r => r.ttftMs)) : null,
    });
    console.log("");
  }

  console.log("Summary (successful runs only)");
  console.log("==============================");
  for (const row of summary) {
    console.log(`${row.name}`);
    console.log(`  success     : ${row.successRuns}/${row.totalRuns}`);
    if (row.successRuns === 0) {
      console.log("  (no successful runs)");
      continue;
    }
    console.log(`  avg headers : ${row.avgHeadersMs} ms  (HTTP response headers)`);
    console.log(`  avg TTFT    : ${row.avgTtftMs} ms  (first content token)`);
    console.log(`  avg total   : ${row.avgTotalMs} ms  (stream complete)`);
    console.log(`  TTFT range  : ${row.minTtftMs} – ${row.maxTtftMs} ms`);
    console.log("");
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
