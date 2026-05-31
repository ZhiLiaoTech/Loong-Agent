// One-shot local gateway smoke: health + dashboard + key RPCs (incl. cron list).
const url = (process.env.URL ?? "http://127.0.0.1:18790").replace(/\/+$/, "");
const secret = process.env.SECRET ?? "loong-test";
const auth = { authorization: `Bearer ${secret}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < 25000) {
    try {
      const r = await fetch(`${url}/health`, { headers: auth, signal: AbortSignal.timeout(1500) });
      if (r.ok) return await r.json();
      last = `HTTP ${r.status}`;
    } catch (e) { last = String(e?.message ?? e); }
    await sleep(300);
  }
  throw new Error(`gateway not healthy in 25s (${last})`);
}

async function rpc(type, params) {
  const r = await fetch(`${url}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ type, id: `t-${type}`, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(5000),
  });
  return await r.json();
}

const health = await waitHealth();
console.log("HEALTH:", JSON.stringify(health));

const home = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) });
const html = await home.text();
const tabs = ["run", "models", "agents", "observe", "system"];
console.log("DASHBOARD: http", home.status,
  "| titleOk", /<title>Loong\b[^<]*<\/title>/.test(html),
  "| tabsOk", tabs.every((t) => html.includes(`data-tab="${t}"`)),
  "| bytes", html.length);

const connect = await rpc("connect");
console.log("RPC connect ok:", connect.ok);

const providers = await rpc("providers.list");
console.log("RPC providers.list ok:", providers.ok,
  "| providers:", JSON.stringify(providers.result?.providers ?? providers.providers ?? providers.result ?? null).slice(0, 160));

const crons = await rpc("cron.jobs.list");
console.log("RPC cron.jobs.list RAW keys:", Object.keys(crons), "| top-level:", JSON.stringify(crons).slice(0, 220));
const jobs = crons.result?.jobs ?? crons.jobs ?? crons.payload?.jobs ?? crons.data?.jobs ?? [];
console.log("RPC cron.jobs.list ok:", crons.ok, "| resolved count:", jobs.length);
console.log("CRON sample:", JSON.stringify(
  jobs.slice(0, 4).map((j) => ({ id: j.id, schedule: j.schedule, enabled: j.enabled, suite: j.metadata?.suiteId })),
));

console.log("SMOKE_DONE");
