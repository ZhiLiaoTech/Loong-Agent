export function getDashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dragon</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --panel: transparent;
      --text: #171716;
      --muted: #6f6f6a;
      --line: #e5e5e0;
      --soft: #f6f6f3;
      --accent: #171716;
      --ok: #18703a;
      --warn: #9a6500;
      --danger: #8f1d1d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    main {
      width: min(1120px, calc(100% - 36px));
      margin: 18px auto 48px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }
    h1, h2, h3, p {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 23px;
      line-height: 1.15;
      font-weight: 640;
    }
    h2 {
      font-size: 13px;
      font-weight: 620;
      text-transform: uppercase;
      color: var(--muted);
    }
    h3 {
      font-size: 14px;
      font-weight: 620;
    }
    button, input, textarea, select {
      font: inherit;
      letter-spacing: 0;
    }
    button {
      min-height: 32px;
      border: 1px solid var(--accent);
      border-radius: 4px;
      background: var(--accent);
      color: #fff;
      padding: 6px 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    button.secondary,
    button.tab {
      background: #fff;
      color: var(--text);
      border-color: var(--line);
    }
    button.danger {
      background: #fff;
      color: var(--danger);
      border-color: #d8b6b6;
    }
    button.link {
      min-height: auto;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      text-decoration: underline;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: #fff;
      color: var(--text);
      outline: none;
      padding: 9px 10px;
    }
    input[type="checkbox"] {
      width: auto;
      margin: 0;
    }
    textarea {
      min-height: 136px;
      resize: vertical;
    }
    input:focus, textarea:focus {
      border-color: var(--accent);
    }
    label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 620px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    th, td {
      border-top: 1px solid var(--line);
      padding: 9px 6px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 560;
    }
    code, .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    pre {
      margin: 8px 0 0;
      max-height: 220px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-radius: 4px;
      background: var(--soft);
      color: var(--muted);
      padding: 8px;
    }
    .subtle { color: var(--muted); }
    .stack {
      display: grid;
      gap: 18px;
      margin-top: 16px;
    }
    .panel {
      border-top: 1px solid var(--line);
      border-radius: 0;
      background: var(--panel);
      padding: 16px 0 0;
    }
    .panel-head,
    .actions,
    .status,
    .event-line,
    .plugin-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .panel-head {
      margin-bottom: 12px;
    }
    .status {
      justify-content: flex-end;
      color: var(--muted);
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #999;
    }
    .dot.ok { background: var(--ok); }
    .dot.warn { background: var(--warn); }
    .composer-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 200px 200px 200px;
      gap: 12px;
      align-items: end;
    }
    .cron-grid {
      display: grid;
      grid-template-columns: 160px 160px 160px minmax(0, 1fr) 92px;
      gap: 12px;
      align-items: end;
      margin-bottom: 14px;
    }
    .model-grid {
      display: grid;
      grid-template-columns: 150px 150px minmax(150px, 1fr) minmax(180px, 1fr);
      gap: 12px;
      align-items: end;
      margin-bottom: 12px;
    }
    .check-row {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .check-row label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      color: var(--text);
      font-size: 13px;
    }
    .message-field {
      margin-top: 12px;
    }
    .actions {
      justify-content: flex-end;
      margin-top: 12px;
    }
    .overview {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 24px;
    }
    .metric {
      min-width: 0;
      padding: 0;
      border-left: 0;
    }
    .metric:first-child {
      padding-left: 0;
      border-left: 0;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
    .metric strong {
      display: block;
      margin-top: 3px;
      font-size: 20px;
      font-weight: 620;
      overflow-wrap: anywhere;
    }
    .tabs {
      display: flex;
      gap: 18px;
      overflow-x: auto;
      padding-bottom: 0;
      border-bottom: 1px solid var(--line);
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 4px 0 8px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: transparent;
      color: var(--muted);
    }
    .tab[aria-selected="true"] {
      border-bottom-color: var(--accent);
      background: transparent;
      color: var(--text);
    }
    .count {
      color: inherit;
      opacity: .72;
      font-size: 12px;
    }
    [data-panel] {
      display: none;
    }
    [data-panel].active {
      display: block;
    }
    .kv {
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr);
      gap: 6px 12px;
      color: var(--muted);
    }
    .kv strong {
      color: var(--text);
      font-weight: 540;
      overflow-wrap: anywhere;
    }
    .empty {
      color: var(--muted);
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .events {
      display: grid;
      gap: 8px;
      max-height: 540px;
      overflow: auto;
      padding-right: 2px;
    }
    .event,
    .plugin,
    .candidate {
      border-top: 1px solid var(--line);
      padding-top: 10px;
    }
    .event:first-child,
    .plugin:first-child,
    .candidate:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .event b,
    .plugin strong,
    .candidate strong {
      font-weight: 600;
    }
    .plugin {
      padding-bottom: 10px;
    }
    .candidate {
      display: grid;
      gap: 8px;
      padding-bottom: 12px;
    }
    .candidate-meta {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .candidate-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .plugin-meta {
      margin-top: 4px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .state-running,
    .state-completed {
      color: var(--ok);
    }
    .state-cancelling,
    .state-cancelled,
    .state-timeout {
      color: var(--warn);
    }
    .state-error {
      color: var(--danger);
    }
    .right-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    @media (max-width: 820px) {
      main {
        width: min(100% - 20px, 1080px);
        margin-top: 14px;
      }
      header,
      .composer-grid,
      .cron-grid,
      .model-grid,
      .overview {
        display: block;
      }
      .status {
        justify-content: flex-start;
        margin-top: 8px;
      }
      .composer-grid > * + *,
      .cron-grid > * + *,
      .model-grid > * + *,
      .metric + .metric {
        margin-top: 12px;
      }
      .metric {
        padding: 10px 0 0;
        border-left: 0;
        border-top: 1px solid var(--line);
      }
      .metric:first-child {
        padding-top: 0;
        border-top: 0;
      }
      .panel {
        padding: 14px 0 0;
      }
      th:nth-child(3),
      td:nth-child(3) {
        display: none;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Dragon</h1>
        <p class="subtle">Gateway</p>
      </div>
      <div class="status"><span id="healthDot" class="dot"></span><span id="healthText">checking</span></div>
    </header>

    <div class="stack">
      <section class="panel">
        <div class="panel-head">
          <h2>Run</h2>
          <button id="sendBtn">Send</button>
        </div>
        <div class="composer-grid">
          <div>
            <label for="sessionId">Session</label>
            <input id="sessionId" value="dashboard" autocomplete="off">
          </div>
          <div>
            <label for="workspace">Workspace</label>
            <input id="workspace" autocomplete="off" placeholder="optional">
          </div>
          <div>
            <label for="model">Model</label>
            <input id="model" list="modelSuggestions" autocomplete="off" placeholder="optional">
            <datalist id="modelSuggestions"></datalist>
          </div>
          <div>
            <label for="secret">Shared Secret</label>
            <input id="secret" type="password" autocomplete="off" placeholder="optional">
          </div>
        </div>
        <div class="message-field">
          <label for="message">Message</label>
          <textarea id="message"></textarea>
        </div>
      </section>

      <section class="panel">
        <div class="overview">
          <div class="metric"><span>Runs</span><strong id="metricRuns">0</strong></div>
          <div class="metric"><span>Active</span><strong id="metricActive">0</strong></div>
          <div class="metric"><span>Providers</span><strong id="metricProviders">0</strong></div>
          <div class="metric"><span>Plugins</span><strong id="metricPlugins">0</strong></div>
          <div class="metric"><span>Events</span><strong id="metricEvents">0</strong></div>
        </div>
      </section>

      <nav class="tabs" aria-label="Dashboard views">
        <button class="tab" data-tab="runs" aria-selected="true">Runs <span id="runCount" class="count">0</span></button>
        <button class="tab" data-tab="events" aria-selected="false">Events <span id="eventCount" class="count">0</span></button>
        <button class="tab" data-tab="providers" aria-selected="false">Providers <span id="providerCount" class="count">0</span></button>
        <button class="tab" data-tab="models" aria-selected="false">Models <span id="modelConfigCount" class="count">0</span></button>
        <button class="tab" data-tab="plugins" aria-selected="false">Plugins <span id="pluginCount" class="count">0</span></button>
        <button class="tab" data-tab="tools" aria-selected="false">Tools <span id="toolCount" class="count">0</span></button>
        <button class="tab" data-tab="memory" aria-selected="false">Memory <span id="memoryCount" class="count">0</span></button>
        <button class="tab" data-tab="cron" aria-selected="false">Cron <span id="cronCount" class="count">0</span></button>
        <button class="tab" data-tab="trajectory" aria-selected="false">Trajectory <span id="trajectoryCount" class="count">0</span></button>
        <button class="tab" data-tab="gateway" aria-selected="false">Gateway</button>
      </nav>

      <section id="runsPanel" class="panel active" data-panel="runs">
        <div class="panel-head">
          <h2>Runs</h2>
          <button id="refreshRunsBtn" class="secondary">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>State</th><th>Run</th><th>Preview</th><th></th></tr>
            </thead>
            <tbody id="runsBody"></tbody>
          </table>
        </div>
        <div id="runsEmpty" class="empty">No runs yet.</div>
      </section>

      <section id="eventsPanel" class="panel" data-panel="events">
        <div class="panel-head">
          <h2>Events</h2>
          <div class="right-actions">
            <span class="subtle" id="eventStatus">connecting</span>
            <button id="reconnectBtn" class="secondary">Reconnect</button>
          </div>
        </div>
        <div id="events" class="events"></div>
      </section>

      <section id="pluginsPanel" class="panel" data-panel="plugins">
        <div class="panel-head">
          <h2>Plugins</h2>
          <button id="refreshPluginsBtn" class="secondary">Refresh</button>
        </div>
        <div id="plugins"></div>
        <div id="pluginsEmpty" class="empty">No plugins loaded.</div>
      </section>

      <section id="providersPanel" class="panel" data-panel="providers">
        <div class="panel-head">
          <h2>Providers</h2>
          <button id="refreshProvidersBtn" class="secondary">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Provider</th><th>Default Model</th><th>Models</th><th>Tools</th></tr>
            </thead>
            <tbody id="providersBody"></tbody>
          </table>
        </div>
        <div id="providersEmpty" class="empty">No providers loaded.</div>
      </section>

      <section id="modelsPanel" class="panel" data-panel="models">
        <div class="panel-head">
          <h2>Models</h2>
          <div class="right-actions">
            <button id="refreshModelConfigBtn" class="secondary">Refresh</button>
            <button id="saveModelConfigBtn">Save</button>
          </div>
        </div>
        <div class="model-grid">
          <div>
            <label for="modelProviderType">Type</label>
            <select id="modelProviderType">
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div>
            <label for="modelProviderId">Provider ID</label>
            <input id="modelProviderId" autocomplete="off" placeholder="openai">
          </div>
          <div>
            <label for="modelProviderName">Display Name</label>
            <input id="modelProviderName" autocomplete="off" placeholder="OpenAI">
          </div>
          <div>
            <label for="modelProviderKey">API Key</label>
            <input id="modelProviderKey" type="password" autocomplete="off" placeholder="leave blank to keep">
          </div>
          <div>
            <label for="modelProviderBaseUrl">Base URL</label>
            <input id="modelProviderBaseUrl" autocomplete="off" placeholder="https://api.openai.com/v1">
          </div>
          <div>
            <label for="modelProviderDefaultModel">Default Model</label>
            <input id="modelProviderDefaultModel" autocomplete="off" placeholder="gpt-4.1-mini">
          </div>
          <div>
            <label>&nbsp;</label>
            <button id="upsertModelProviderBtn">Add / Update</button>
          </div>
          <div>
            <label>&nbsp;</label>
            <button id="clearModelProviderBtn" class="secondary">Clear</button>
          </div>
        </div>
        <div class="check-row">
          <label><input id="modelProviderEnabled" type="checkbox" checked> Enabled</label>
          <label><input id="modelProviderTools" type="checkbox" checked> Tool Calling</label>
          <span id="modelConfigPath" class="subtle"></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Provider</th><th>Type</th><th>Default Model</th><th>API Key</th><th></th></tr>
            </thead>
            <tbody id="modelConfigBody"></tbody>
          </table>
        </div>
        <div id="modelConfigEmpty" class="empty">No model providers configured.</div>
        <pre id="modelConfigResult" style="display:none;"></pre>
      </section>

      <section id="toolsPanel" class="panel" data-panel="tools">
        <div class="panel-head">
          <h2>Tools</h2>
          <button id="refreshToolsBtn" class="secondary">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Tool</th><th>Access</th><th></th></tr>
            </thead>
            <tbody id="toolsBody"></tbody>
          </table>
        </div>
        <div id="toolsEmpty" class="empty">No tools available.</div>
        <pre id="toolResult" style="display:none;"></pre>
      </section>

      <section id="memoryPanel" class="panel" data-panel="memory">
        <div class="panel-head">
          <h2>Memory</h2>
          <button id="refreshMemoryBtn" class="secondary">Refresh</button>
        </div>
        <div id="memoryCandidates"></div>
        <div id="memoryEmpty" class="empty">No pending memory candidates.</div>
        <pre id="memoryResult" style="display:none;"></pre>
      </section>

      <section id="cronPanel" class="panel" data-panel="cron">
        <div class="panel-head">
          <h2>Cron</h2>
          <div class="right-actions">
            <button id="tickCronBtn" class="secondary">Tick</button>
            <button id="refreshCronBtn" class="secondary">Refresh</button>
          </div>
        </div>
        <div class="cron-grid">
          <div>
            <label for="cronId">Job</label>
            <input id="cronId" autocomplete="off" placeholder="daily-review">
          </div>
          <div>
            <label for="cronSchedule">Schedule</label>
            <input id="cronSchedule" autocomplete="off" placeholder="0 9 * * *">
          </div>
          <div>
            <label for="cronSession">Session</label>
            <input id="cronSession" autocomplete="off" value="cron">
          </div>
          <div>
            <label for="cronMessage">Message</label>
            <input id="cronMessage" autocomplete="off" placeholder="Run scheduled task">
          </div>
          <div>
            <label for="cronEnabled">Enabled</label>
            <input id="cronEnabled" type="checkbox" checked>
          </div>
        </div>
        <div class="actions">
          <button id="saveCronBtn">Save Job</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Job</th><th>Schedule</th><th>Next</th><th></th></tr>
            </thead>
            <tbody id="cronBody"></tbody>
          </table>
        </div>
        <div id="cronEmpty" class="empty">No cron jobs configured.</div>
        <pre id="cronResult" style="display:none;"></pre>
      </section>

      <section id="trajectoryPanel" class="panel" data-panel="trajectory">
        <div class="panel-head">
          <h2>Trajectory</h2>
          <button id="refreshTrajectoryBtn" class="secondary">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Status</th><th>Run</th><th>Prompt</th><th></th></tr>
            </thead>
            <tbody id="trajectoryBody"></tbody>
          </table>
        </div>
        <div id="trajectoryEmpty" class="empty">No trajectory for this session.</div>
        <pre id="trajectoryDetail" style="display:none;"></pre>
      </section>

      <section id="gatewayPanel" class="panel" data-panel="gateway">
        <div class="panel-head">
          <h2>Gateway</h2>
          <button id="refreshHealthBtn" class="secondary">Refresh</button>
        </div>
        <div class="kv" id="healthDetails"></div>
      </section>
    </div>
  </main>

  <script>
    const state = {
      activeTab: "runs",
      eventController: null,
      eventGeneration: 0,
      reconnectTimer: 0,
      events: [],
      runs: [],
      trajectories: [],
      providers: [],
      modelConfig: { providers: [], appliesOn: "restart" },
      editingModelProviderId: "",
      plugins: [],
      tools: [],
      memoryCandidates: [],
      memoryReview: { canPromote: false, canReject: false },
      cronJobs: [],
      secret: "",
    };

    const $ = (id) => document.getElementById(id);

    $("secret").value = state.secret;
    $("secret").addEventListener("input", () => {
      state.secret = $("secret").value.trim();
    });
    $("secret").addEventListener("change", () => {
      refreshHealth();
      refreshPlugins();
      refreshTools();
      refreshMemoryCandidates();
      refreshCronJobs();
      refreshModelConfig();
      connectEvents();
    });

    document.querySelectorAll("[data-tab]").forEach(button => {
      button.addEventListener("click", () => setTab(button.getAttribute("data-tab")));
    });

    $("sendBtn").addEventListener("click", sendRun);
    $("refreshRunsBtn").addEventListener("click", refreshRuns);
    $("refreshTrajectoryBtn").addEventListener("click", refreshTrajectories);
    $("refreshProvidersBtn").addEventListener("click", refreshProviders);
    $("refreshModelConfigBtn").addEventListener("click", refreshModelConfig);
    $("saveModelConfigBtn").addEventListener("click", saveModelConfig);
    $("upsertModelProviderBtn").addEventListener("click", upsertModelProviderConfig);
    $("clearModelProviderBtn").addEventListener("click", clearModelProviderForm);
    $("refreshPluginsBtn").addEventListener("click", refreshPlugins);
    $("refreshToolsBtn").addEventListener("click", refreshTools);
    $("refreshMemoryBtn").addEventListener("click", refreshMemoryCandidates);
    $("refreshCronBtn").addEventListener("click", refreshCronJobs);
    $("saveCronBtn").addEventListener("click", saveCronJob);
    $("tickCronBtn").addEventListener("click", tickCron);
    $("refreshHealthBtn").addEventListener("click", refreshHealth);
    $("reconnectBtn").addEventListener("click", connectEvents);

    function setTab(tab) {
      state.activeTab = tab || "runs";
      document.querySelectorAll("[data-tab]").forEach(button => {
        button.setAttribute("aria-selected", button.getAttribute("data-tab") === state.activeTab ? "true" : "false");
      });
      document.querySelectorAll("[data-panel]").forEach(panel => {
        panel.classList.toggle("active", panel.getAttribute("data-panel") === state.activeTab);
      });
      if (state.activeTab === "trajectory") refreshTrajectories();
      if (state.activeTab === "providers") refreshProviders();
      if (state.activeTab === "models") refreshModelConfig();
      if (state.activeTab === "plugins") refreshPlugins();
      if (state.activeTab === "tools") refreshTools();
      if (state.activeTab === "memory") refreshMemoryCandidates();
      if (state.activeTab === "cron") refreshCronJobs();
      if (state.activeTab === "gateway") refreshHealth();
    }

    function authHeaders(json = false) {
      const headers = {};
      if (json) headers["content-type"] = "application/json";
      if (state.secret) headers.authorization = "Bearer " + state.secret;
      return headers;
    }

    function requestId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
      return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    }

    async function rpc(type, params) {
      const response = await fetch("/rpc", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ type, id: requestId(), params }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "RPC failed");
      return json.payload;
    }

    async function refreshHealth() {
      try {
        const response = await fetch("/health", { headers: authHeaders() });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "health failed");
        $("healthDot").className = "dot ok";
        $("healthText").textContent = "online";
        renderHealth(json);
      } catch (error) {
        $("healthDot").className = "dot warn";
        $("healthText").textContent = "offline";
        $("healthDetails").innerHTML = "";
      }
    }

    function renderHealth(json) {
      $("healthDetails").innerHTML = [
        ["Name", json.name],
        ["Address", json.address && json.address.url ? json.address.url : location.origin],
        ["Uptime", formatMs(json.uptimeMs || 0)],
        ["Providers", json.providerCount || 0],
        ["Plugins", json.pluginCount || 0],
      ].map(([key, value]) => {
        return "<span>" + escapeHtml(key) + "</span><strong>" + escapeHtml(String(value ?? "")) + "</strong>";
      }).join("");
    }

    async function sendRun() {
      const message = $("message").value.trim();
      if (!message) return;
      $("sendBtn").disabled = true;
      try {
        const params = {
          sessionId: $("sessionId").value.trim() || "dashboard",
          message,
          source: "web",
        };
        const workspace = $("workspace").value.trim();
        if (workspace) params.workspace = workspace;
        const model = $("model").value.trim();
        if (model) params.model = model;
        await rpc("agent", params);
        $("message").value = "";
        await refreshRuns();
        setTab("runs");
      } catch (error) {
        pushLocalEvent("error", error.message || String(error));
        setTab("events");
      } finally {
        $("sendBtn").disabled = false;
      }
    }

    async function refreshRuns() {
      try {
        const payload = await rpc("runs.list", { limit: 20 });
        state.runs = payload.runs || [];
        renderRuns();
      } catch (error) {
        pushLocalEvent("error", error.message || String(error));
      }
    }

    async function refreshTrajectories() {
      try {
        const payload = await rpc("trajectory.list", {
          sessionId: $("sessionId").value.trim() || "dashboard",
          limit: 12,
        });
        state.trajectories = payload.trajectories || [];
        renderTrajectories();
      } catch {
        state.trajectories = [];
        renderTrajectories();
      }
    }

    async function refreshPlugins() {
      try {
        const payload = await rpc("plugins.list");
        state.plugins = payload.plugins || [];
        renderPlugins();
      } catch {
        state.plugins = [];
        renderPlugins();
      }
    }

    async function refreshProviders() {
      try {
        const payload = await rpc("providers.list");
        state.providers = payload.providers || [];
        renderProviders();
      } catch {
        state.providers = [];
        renderProviders();
      }
    }

    async function refreshModelConfig() {
      try {
        const payload = await rpc("model.config.get");
        state.modelConfig = {
          providers: payload.providers || [],
          appliesOn: payload.appliesOn || "restart",
          configPath: payload.configPath || "",
        };
        renderModelConfig();
      } catch (error) {
        state.modelConfig = { providers: [], appliesOn: "restart" };
        renderModelConfig();
        $("modelConfigResult").style.display = "block";
        $("modelConfigResult").textContent = error.message || String(error);
      }
    }

    async function refreshTools() {
      try {
        const payload = await rpc("tools.catalog");
        state.tools = payload.tools || [];
        renderTools();
      } catch {
        state.tools = [];
        renderTools();
      }
    }

    async function refreshMemoryCandidates() {
      try {
        const payload = await rpc("memory.candidates.list", { status: "pending", limit: 20 });
        state.memoryCandidates = payload.output?.candidates || [];
        state.memoryReview = payload.review || { canPromote: false, canReject: false };
        renderMemoryCandidates();
      } catch {
        state.memoryCandidates = [];
        state.memoryReview = { canPromote: false, canReject: false };
        renderMemoryCandidates();
      }
    }

    async function refreshCronJobs() {
      try {
        const payload = await rpc("cron.jobs.list");
        state.cronJobs = payload.jobs || [];
        renderCronJobs();
      } catch {
        state.cronJobs = [];
        renderCronJobs();
      }
    }

    async function saveModelConfig() {
      $("modelConfigResult").style.display = "block";
      $("modelConfigResult").textContent = "saving...";
      try {
        const payload = await rpc("model.config.save", {
          providers: state.modelConfig.providers || [],
        });
        state.modelConfig = {
          providers: payload.providers || [],
          appliesOn: payload.appliesOn || "restart",
          configPath: payload.configPath || "",
        };
        renderModelConfig();
        $("modelConfigResult").textContent = "saved; restart required";
        await refreshProviders();
      } catch (error) {
        $("modelConfigResult").textContent = error.message || String(error);
      }
    }

    function upsertModelProviderConfig() {
      const id = $("modelProviderId").value.trim();
      if (!id) return;
      const provider = {
        id,
        type: $("modelProviderType").value,
        enabled: $("modelProviderEnabled").checked,
        supportsToolCalling: $("modelProviderTools").checked,
      };
      const displayName = $("modelProviderName").value.trim();
      const apiKey = $("modelProviderKey").value.trim();
      const baseUrl = $("modelProviderBaseUrl").value.trim();
      const defaultModel = $("modelProviderDefaultModel").value.trim();
      if (displayName) provider.displayName = displayName;
      if (apiKey) provider.apiKey = apiKey;
      if (baseUrl) provider.baseUrl = baseUrl;
      if (defaultModel) provider.defaultModel = defaultModel;

      const existing = (state.modelConfig.providers || []).find(item => item.id === id || item.id === state.editingModelProviderId);
      if (!provider.apiKey && existing?.apiKeyConfigured && existing.id === id) {
        provider.apiKeyConfigured = true;
      }
      const next = (state.modelConfig.providers || [])
        .filter(item => item.id !== id && item.id !== state.editingModelProviderId);
      next.push(provider);
      state.modelConfig = {
        ...state.modelConfig,
        providers: next.sort((left, right) => String(left.id).localeCompare(String(right.id))),
      };
      clearModelProviderForm();
      renderModelConfig();
    }

    function clearModelProviderForm() {
      state.editingModelProviderId = "";
      $("modelProviderType").value = "openai-compatible";
      $("modelProviderId").value = "";
      $("modelProviderName").value = "";
      $("modelProviderKey").value = "";
      $("modelProviderBaseUrl").value = "";
      $("modelProviderDefaultModel").value = "";
      $("modelProviderEnabled").checked = true;
      $("modelProviderTools").checked = true;
    }

    function editModelProviderConfig(id) {
      const provider = (state.modelConfig.providers || []).find(item => item.id === id);
      if (!provider) return;
      state.editingModelProviderId = provider.id || "";
      $("modelProviderType").value = provider.type || "openai-compatible";
      $("modelProviderId").value = provider.id || "";
      $("modelProviderName").value = provider.displayName || "";
      $("modelProviderKey").value = "";
      $("modelProviderBaseUrl").value = provider.baseUrl || "";
      $("modelProviderDefaultModel").value = provider.defaultModel || "";
      $("modelProviderEnabled").checked = provider.enabled !== false;
      $("modelProviderTools").checked = provider.supportsToolCalling !== false;
    }

    function removeModelProviderConfig(id) {
      state.modelConfig = {
        ...state.modelConfig,
        providers: (state.modelConfig.providers || []).filter(item => item.id !== id),
      };
      if (state.editingModelProviderId === id) {
        clearModelProviderForm();
      }
      renderModelConfig();
    }

    async function saveCronJob() {
      const id = $("cronId").value.trim();
      const schedule = $("cronSchedule").value.trim();
      const sessionId = $("cronSession").value.trim();
      const message = $("cronMessage").value.trim();
      if (!id || !schedule || !sessionId || !message) return;
      $("cronResult").style.display = "block";
      $("cronResult").textContent = "saving...";
      try {
        const payload = await rpc("cron.job.upsert", {
          id,
          schedule,
          sessionId,
          message,
          enabled: $("cronEnabled").checked,
          metadata: { source: "dashboard" },
        });
        $("cronResult").textContent = JSON.stringify(payload.job, null, 2);
        await refreshCronJobs();
      } catch (error) {
        $("cronResult").textContent = error.message || String(error);
      }
    }

    async function removeCronJob(id) {
      $("cronResult").style.display = "block";
      $("cronResult").textContent = "removing...";
      try {
        const payload = await rpc("cron.job.remove", { id });
        $("cronResult").textContent = JSON.stringify(payload, null, 2);
        await refreshCronJobs();
      } catch (error) {
        $("cronResult").textContent = error.message || String(error);
      }
    }

    async function editCronJob(id) {
      const job = state.cronJobs.find(item => item.id === id);
      if (!job) return;
      $("cronId").value = job.id || "";
      $("cronSchedule").value = job.schedule || "";
      $("cronSession").value = job.sessionId || "";
      $("cronMessage").value = job.message || "";
      $("cronEnabled").checked = job.enabled !== false;
    }

    async function tickCron() {
      $("cronResult").style.display = "block";
      $("cronResult").textContent = "ticking...";
      try {
        const payload = await rpc("cron.tick");
        $("cronResult").textContent = JSON.stringify(payload, null, 2);
        await refreshCronJobs();
      } catch (error) {
        $("cronResult").textContent = error.message || String(error);
      }
    }

    async function invokeTool(toolName) {
      const tool = state.tools.find(item => item.name === toolName);
      if (!tool || !tool.directInvokeAllowed) return;
      const params = {
        toolName,
        input: defaultToolInput(toolName),
        sessionId: $("sessionId").value.trim() || "dashboard",
      };
      const workspace = $("workspace").value.trim();
      if (workspace) params.workspace = workspace;
      $("toolResult").style.display = "block";
      $("toolResult").textContent = "running " + toolName + "...";
      try {
        const payload = await rpc("tool.invoke", params);
        $("toolResult").textContent = JSON.stringify(payload, null, 2);
      } catch (error) {
        $("toolResult").textContent = error.message || String(error);
      }
    }

    function defaultToolInput(toolName) {
      if (toolName === "git_status") return { porcelain: false };
      if (toolName === "git_diff") return { stat: true, maxChars: 20000 };
      if (toolName === "git_log") return { limit: 10, maxChars: 20000 };
      return {};
    }

    async function promoteMemoryCandidate(id) {
      $("memoryResult").style.display = "block";
      $("memoryResult").textContent = "promoting...";
      try {
        const payload = await rpc("memory.candidate.promote", { id, source: "dashboard" });
        $("memoryResult").textContent = JSON.stringify(payload.output, null, 2);
        await refreshMemoryCandidates();
      } catch (error) {
        $("memoryResult").textContent = error.message || String(error);
      }
    }

    async function rejectMemoryCandidate(id) {
      $("memoryResult").style.display = "block";
      $("memoryResult").textContent = "rejecting...";
      try {
        const payload = await rpc("memory.candidate.reject", { id, reason: "Rejected from dashboard." });
        $("memoryResult").textContent = JSON.stringify(payload.output, null, 2);
        await refreshMemoryCandidates();
      } catch (error) {
        $("memoryResult").textContent = error.message || String(error);
      }
    }

    async function loadTrajectory(runId) {
      try {
        const payload = await rpc("trajectory.get", {
          sessionId: $("sessionId").value.trim() || "dashboard",
          runId,
          maxEvents: 80,
        });
        $("trajectoryDetail").style.display = "block";
        $("trajectoryDetail").textContent = JSON.stringify(payload.record, null, 2);
      } catch (error) {
        $("trajectoryDetail").style.display = "block";
        $("trajectoryDetail").textContent = error.message || String(error);
      }
    }

    async function cancelRun(runId) {
      try {
        await rpc("run.cancel", { runId, reason: "Cancelled from dashboard." });
        await refreshRuns();
      } catch (error) {
        pushLocalEvent("error", error.message || String(error));
      }
    }

    function renderRuns() {
      const activeRuns = state.runs.filter(run => run.state === "running" || run.state === "cancelling").length;
      $("runCount").textContent = String(state.runs.length);
      $("metricRuns").textContent = String(state.runs.length);
      $("metricActive").textContent = String(activeRuns);
      $("runsEmpty").style.display = state.runs.length ? "none" : "block";
      $("runsBody").innerHTML = state.runs.map(run => {
        const canCancel = run.state === "running" || run.state === "cancelling";
        const stateClass = "state-" + escapeHtml(run.state || "");
        return "<tr>" +
          "<td class='" + stateClass + "'>" + escapeHtml(run.state) + "</td>" +
          "<td><code>" + escapeHtml(shortId(run.runId)) + "</code><br><span class='subtle'>" + escapeHtml(run.sessionId || "") + "</span></td>" +
          "<td>" + escapeHtml(run.result?.assistantPreview || run.messagePreview || run.error || "") + "</td>" +
          "<td>" + (canCancel ? "<button class='danger' data-cancel='" + escapeHtml(run.runId) + "'>Cancel</button>" : "") + "</td>" +
          "</tr>";
      }).join("");
      document.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", () => cancelRun(button.getAttribute("data-cancel")));
      });
      renderMetrics();
    }

    function renderTrajectories() {
      $("trajectoryCount").textContent = String(state.trajectories.length);
      $("trajectoryEmpty").style.display = state.trajectories.length ? "none" : "block";
      $("trajectoryBody").innerHTML = state.trajectories.map(item => {
        const statusClass = "state-" + escapeHtml(item.status || "");
        return "<tr>" +
          "<td class='" + statusClass + "'>" + escapeHtml(item.status || "") + "</td>" +
          "<td><code>" + escapeHtml(shortId(item.runId)) + "</code><br><span class='subtle'>" + escapeHtml(formatTime(item.createdAt)) + "</span></td>" +
          "<td>" + escapeHtml(item.userPreview || "") + "</td>" +
          "<td><button class='secondary' data-trajectory='" + escapeHtml(item.runId) + "'>View</button></td>" +
          "</tr>";
      }).join("");
      document.querySelectorAll("[data-trajectory]").forEach(button => {
        button.addEventListener("click", () => loadTrajectory(button.getAttribute("data-trajectory")));
      });
    }

    function renderPlugins() {
      $("pluginCount").textContent = String(state.plugins.length);
      $("metricPlugins").textContent = String(state.plugins.length);
      $("pluginsEmpty").style.display = state.plugins.length ? "none" : "block";
      $("plugins").innerHTML = state.plugins.map(plugin => {
        const tools = (plugin.tools || []).map(tool => tool.name + (tool.permission ? ":" + tool.permission : "")).join(", ");
        const providers = (plugin.providers || []).map(provider => {
          return provider.displayName && provider.displayName !== provider.id
            ? provider.id + " (" + provider.displayName + ")"
            : provider.id;
        }).join(", ");
        const memoryBackends = (plugin.memoryBackends || []).map(backend => {
          return backend.displayName && backend.displayName !== backend.id
            ? backend.id + " (" + backend.displayName + ")"
            : backend.id;
        }).join(", ");
        const hooks = (plugin.lifecycleHooks || []).join(", ");
        const counts = (plugin.tools || []).length + " tools / "
          + (plugin.providers || []).length + " providers / "
          + (plugin.memoryBackends || []).length + " memory";
        const details = [
          plugin.description || "",
          tools ? "tools: " + tools : "",
          providers ? "providers: " + providers : "",
          memoryBackends ? "memory: " + memoryBackends : "",
          hooks ? "hooks: " + hooks : "",
        ].filter(Boolean).join("\\n");
        return "<div class='plugin'>" +
          "<div class='plugin-title'><strong>" + escapeHtml(plugin.name || "") + "</strong><span class='subtle'>" + escapeHtml(plugin.version || "") + "</span></div>" +
          "<div class='plugin-meta'>" + escapeHtml(counts) + "</div>" +
          (details ? "<pre>" + escapeHtml(details) + "</pre>" : "") +
        "</div>";
      }).join("");
    }

    function renderProviders() {
      $("providerCount").textContent = String(state.providers.length);
      $("metricProviders").textContent = String(state.providers.length);
      $("providersEmpty").style.display = state.providers.length ? "none" : "block";
      $("providersBody").innerHTML = state.providers.map(provider => {
        const modelText = (provider.models || []).map(model => {
          const badges = [
            model.default ? "default" : "",
            model.capabilities && model.capabilities.toolCalling ? "tools" : "",
            model.contextWindow ? formatCompactNumber(model.contextWindow) + " ctx" : "",
          ].filter(Boolean).join(" / ");
          return model.id + (badges ? " (" + badges + ")" : "");
        }).join("\\n");
        return "<tr>" +
          "<td><strong>" + escapeHtml(provider.id || "") + "</strong><br><span class='subtle'>" + escapeHtml(provider.displayName || "") + "</span></td>" +
          "<td>" + escapeHtml(provider.defaultModel || "") + "</td>" +
          "<td><pre>" + escapeHtml(modelText) + "</pre></td>" +
          "<td>" + escapeHtml(provider.supportsToolCalling ? "yes" : "no") + "</td>" +
          "</tr>";
      }).join("");
      $("modelSuggestions").innerHTML = state.providers.flatMap(provider => {
        const values = [];
        if (provider.defaultModel) {
          values.push(provider.defaultModel);
          values.push(provider.id + ":" + provider.defaultModel);
        }
        (provider.models || []).forEach(model => {
          values.push(model.id);
          values.push(provider.id + ":" + model.id);
          values.push(provider.id + "/" + model.id);
          (model.aliases || []).forEach(alias => {
            values.push(alias);
            values.push(provider.id + ":" + alias);
          });
        });
        return values;
      }).filter((value, index, values) => values.indexOf(value) === index)
        .map(value => "<option value='" + escapeHtml(value) + "'></option>").join("");
    }

    function renderModelConfig() {
      const providers = state.modelConfig.providers || [];
      $("modelConfigCount").textContent = String(providers.length);
      $("modelConfigEmpty").style.display = providers.length ? "none" : "block";
      $("modelConfigPath").textContent = state.modelConfig.configPath || "";
      $("modelConfigBody").innerHTML = providers.map(provider => {
        const meta = [
          provider.enabled === false ? "disabled" : "enabled",
          provider.displayName || "",
          provider.baseUrl || "",
        ].filter(Boolean).join("\\n");
        const model = provider.defaultModel || "";
        const apiKey = provider.apiKeyConfigured || provider.apiKey ? "configured" : "missing";
        return "<tr>" +
          "<td><strong>" + escapeHtml(provider.id || "") + "</strong>" + (meta ? "<pre>" + escapeHtml(meta) + "</pre>" : "") + "</td>" +
          "<td>" + escapeHtml(provider.type || "") + "</td>" +
          "<td>" + escapeHtml(model) + "</td>" +
          "<td>" + escapeHtml(apiKey) + "</td>" +
          "<td><div class='right-actions'>" +
            "<button class='secondary' data-edit-model-provider='" + escapeHtml(provider.id || "") + "'>Edit</button>" +
            "<button class='danger' data-remove-model-provider='" + escapeHtml(provider.id || "") + "'>Remove</button>" +
          "</div></td>" +
          "</tr>";
      }).join("");
      document.querySelectorAll("[data-edit-model-provider]").forEach(button => {
        button.addEventListener("click", () => editModelProviderConfig(button.getAttribute("data-edit-model-provider")));
      });
      document.querySelectorAll("[data-remove-model-provider]").forEach(button => {
        button.addEventListener("click", () => removeModelProviderConfig(button.getAttribute("data-remove-model-provider")));
      });
    }

    function renderTools() {
      $("toolCount").textContent = String(state.tools.length);
      $("toolsEmpty").style.display = state.tools.length ? "none" : "block";
      $("toolsBody").innerHTML = state.tools.map(tool => {
        const capabilities = (tool.capabilities || []).join(", ");
        const access = [
          tool.permission ? "permission: " + tool.permission : "",
          capabilities ? "capabilities: " + capabilities : "",
          tool.directInvokeAllowed ? "direct: yes" : "direct: no",
        ].filter(Boolean).join("\\n");
        const action = tool.directInvokeAllowed
          ? "<button class='secondary' data-tool='" + escapeHtml(tool.name || "") + "'>Run</button>"
          : "";
        return "<tr>" +
          "<td><strong>" + escapeHtml(tool.name || "") + "</strong><br><span class='subtle'>" + escapeHtml(tool.description || "") + "</span></td>" +
          "<td><pre>" + escapeHtml(access) + "</pre></td>" +
          "<td>" + action + "</td>" +
          "</tr>";
      }).join("");
      document.querySelectorAll("[data-tool]").forEach(button => {
        button.addEventListener("click", () => invokeTool(button.getAttribute("data-tool")));
      });
    }

    function renderMemoryCandidates() {
      $("memoryCount").textContent = String(state.memoryCandidates.length);
      $("memoryEmpty").style.display = state.memoryCandidates.length ? "none" : "block";
      const promoteAttrs = state.memoryReview.canPromote ? "" : " disabled title='Requires write permission'";
      const rejectAttrs = state.memoryReview.canReject ? "" : " disabled title='Requires write permission'";
      $("memoryCandidates").innerHTML = state.memoryCandidates.map(candidate => {
        const meta = [
          candidate.scope || "",
          candidate.sessionId ? "session " + shortId(candidate.sessionId) : "",
          candidate.createdAt ? formatTime(candidate.createdAt) : "",
        ].filter(Boolean).join(" / ");
        return "<div class='candidate'>" +
          "<div><strong>" + escapeHtml(candidate.content || "") + "</strong></div>" +
          "<div class='candidate-meta'>" + escapeHtml(meta) + "</div>" +
          (candidate.reason ? "<pre>" + escapeHtml(candidate.reason) + "</pre>" : "") +
          "<div class='candidate-actions'>" +
            "<button class='secondary' data-promote-memory='" + escapeHtml(candidate.id || "") + "'" + promoteAttrs + ">Promote</button>" +
            "<button class='danger' data-reject-memory='" + escapeHtml(candidate.id || "") + "'" + rejectAttrs + ">Reject</button>" +
          "</div>" +
        "</div>";
      }).join("");
      document.querySelectorAll("[data-promote-memory]").forEach(button => {
        button.addEventListener("click", () => promoteMemoryCandidate(button.getAttribute("data-promote-memory")));
      });
      document.querySelectorAll("[data-reject-memory]").forEach(button => {
        button.addEventListener("click", () => rejectMemoryCandidate(button.getAttribute("data-reject-memory")));
      });
    }

    function renderCronJobs() {
      $("cronCount").textContent = String(state.cronJobs.length);
      $("cronEmpty").style.display = state.cronJobs.length ? "none" : "block";
      $("cronBody").innerHTML = state.cronJobs.map(job => {
        const status = job.enabled === false ? "disabled" : (job.lastStatus || "ready");
        const statusClass = job.enabled === false
          ? "state-cancelled"
          : job.lastStatus === "error"
            ? "state-error"
            : "state-completed";
        const meta = [
          job.sessionId || "",
          job.lastDeliveredAt ? "last " + formatTime(job.lastDeliveredAt) : "",
          job.lastError || "",
        ].filter(Boolean).join(" / ");
        return "<tr>" +
          "<td><strong>" + escapeHtml(job.id || "") + "</strong><br><span class='" + statusClass + "'>" + escapeHtml(status) + "</span></td>" +
          "<td><code>" + escapeHtml(job.schedule || "") + "</code><br><span class='subtle'>" + escapeHtml(meta) + "</span></td>" +
          "<td>" + escapeHtml(job.nextRunAt ? formatDateTime(job.nextRunAt) : "") + "</td>" +
          "<td><div class='right-actions'>" +
            "<button class='secondary' data-edit-cron='" + escapeHtml(job.id || "") + "'>Edit</button>" +
            "<button class='danger' data-remove-cron='" + escapeHtml(job.id || "") + "'>Remove</button>" +
          "</div></td>" +
          "</tr>";
      }).join("");
      document.querySelectorAll("[data-edit-cron]").forEach(button => {
        button.addEventListener("click", () => editCronJob(button.getAttribute("data-edit-cron")));
      });
      document.querySelectorAll("[data-remove-cron]").forEach(button => {
        button.addEventListener("click", () => removeCronJob(button.getAttribute("data-remove-cron")));
      });
    }

    async function connectEvents() {
      clearReconnectTimer();
      const generation = ++state.eventGeneration;
      if (state.eventController) state.eventController.abort();
      const controller = new AbortController();
      state.eventController = controller;
      $("eventStatus").textContent = "connecting";
      try {
        const response = await fetch("/events", { headers: authHeaders(), signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("events unavailable");
        $("eventStatus").textContent = "live";
        await readSse(response.body);
        if (state.eventController === controller && state.eventGeneration === generation) {
          $("eventStatus").textContent = "disconnected";
          scheduleReconnect(generation);
        }
      } catch (error) {
        if (error.name !== "AbortError" && state.eventController === controller && state.eventGeneration === generation) {
          $("eventStatus").textContent = "disconnected";
          pushLocalEvent("error", error.message || String(error));
        }
      }
    }

    function clearReconnectTimer() {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = 0;
      }
    }

    function scheduleReconnect(generation) {
      clearReconnectTimer();
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = 0;
        if (state.eventGeneration === generation) {
          connectEvents();
        }
      }, 2000);
    }

    async function readSse(body) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          handleSseBlock(raw);
        }
      }
    }

    function handleSseBlock(raw) {
      if (!raw || raw.startsWith(":")) return;
      const lines = raw.split(/\r?\n/);
      const name = (lines.find(line => line.startsWith("event: ")) || "event: message").slice(7);
      const data = lines.filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        if (name === "dragon.event") {
          state.events.unshift(parsed);
          state.events = state.events.slice(0, 80);
          renderEvents();
          if (parsed.event?.type === "lifecycle" && ["end", "error", "cancelled"].includes(parsed.event.phase)) {
            refreshRuns();
            refreshTrajectories();
            refreshMemoryCandidates();
          }
        }
      } catch {
        pushLocalEvent(name, data);
      }
    }

    function pushLocalEvent(type, text) {
      state.events.unshift({ timestamp: new Date().toISOString(), event: { type, runId: "local", text } });
      state.events = state.events.slice(0, 80);
      renderEvents();
    }

    function renderEvents() {
      $("eventCount").textContent = String(state.events.length);
      $("metricEvents").textContent = String(state.events.length);
      $("events").innerHTML = state.events.map(envelope => {
        const event = envelope.event || {};
        const label = event.type === "lifecycle" ? event.type + ":" + event.phase : event.type || "event";
        const detail = event.text || event.message || event.toolName || "";
        return "<div class='event'>" +
          "<div class='event-line'><b>" + escapeHtml(label) + "</b><span class='subtle'>" + escapeHtml(formatTime(envelope.timestamp)) + "</span></div>" +
          "<div class='subtle mono'>" + escapeHtml(shortId(event.runId || "")) + (envelope.sessionId ? " / " + escapeHtml(envelope.sessionId) : "") + "</div>" +
          (detail ? "<pre>" + escapeHtml(String(detail)) + "</pre>" : "") +
        "</div>";
      }).join("") || "<div class='empty'>No events yet.</div>";
    }

    function renderMetrics() {
      $("metricProviders").textContent = String(state.providers.length);
      $("metricPlugins").textContent = String(state.plugins.length);
      $("metricEvents").textContent = String(state.events.length);
    }

    function shortId(value) { return value ? String(value).slice(0, 8) : ""; }
    function formatTime(value) { return value ? new Date(value).toLocaleTimeString() : ""; }
    function formatDateTime(value) { return value ? new Date(value).toLocaleString() : ""; }
    function formatMs(ms) {
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) return seconds + "s";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + "m";
      return Math.floor(minutes / 60) + "h";
    }
    function formatCompactNumber(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "";
      if (number >= 1000000) return Math.round(number / 100000) / 10 + "M";
      if (number >= 1000) return Math.round(number / 100) / 10 + "K";
      return String(number);
    }
    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    refreshHealth();
    refreshRuns();
    refreshTrajectories();
    refreshProviders();
    refreshModelConfig();
    refreshPlugins();
    refreshTools();
    refreshMemoryCandidates();
    refreshCronJobs();
    connectEvents();
    setInterval(refreshHealth, 5000);
    setInterval(refreshRuns, 8000);
    setInterval(refreshTrajectories, 12000);
    setInterval(refreshProviders, 15000);
    setInterval(refreshPlugins, 15000);
    setInterval(refreshTools, 15000);
    setInterval(refreshMemoryCandidates, 15000);
    setInterval(refreshCronJobs, 15000);
  </script>
</body>
</html>`;
}
