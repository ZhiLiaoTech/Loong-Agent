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
      --side: #f7f7f4;
      --text: #181816;
      --muted: #70706a;
      --line: #e4e4df;
      --soft: #f4f4f0;
      --accent: #181816;
      --ok: #1d6d3d;
      --warn: #8b6400;
      --danger: #8d2424;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
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
    button.nav-item {
      background: #fff;
      color: var(--text);
      border-color: var(--line);
    }
    button.danger {
      background: #fff;
      color: var(--danger);
      border-color: #d9bbbb;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: .56;
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
      min-height: 128px;
      resize: vertical;
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--accent);
    }
    label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    h1, h2, h3, p {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 22px;
      line-height: 1.15;
      font-weight: 650;
    }
    h2 {
      font-size: 13px;
      font-weight: 650;
      text-transform: uppercase;
      color: var(--muted);
    }
    h3 {
      font-size: 14px;
      font-weight: 650;
    }
    table {
      width: 100%;
      min-width: 640px;
      border-collapse: collapse;
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
    pre {
      margin: 8px 0 0;
      max-height: 230px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-radius: 4px;
      background: var(--soft);
      color: var(--muted);
      padding: 8px;
    }
    code, .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 212px minmax(0, 1fr);
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: var(--side);
      padding: 18px 14px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }
    .brand {
      padding: 0 4px 18px;
      border-bottom: 1px solid var(--line);
    }
    .brand p {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .nav {
      display: grid;
      gap: 6px;
      margin-top: 16px;
    }
    .nav-item {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      border-color: transparent;
      background: transparent;
      color: var(--muted);
      text-align: left;
      padding: 8px 9px;
    }
    .nav-item[aria-selected="true"] {
      background: #fff;
      color: var(--text);
      border-color: var(--line);
    }
    .main {
      min-width: 0;
      padding: 18px 26px 56px;
    }
    .topbar,
    .section-head,
    .actions,
    .right-actions,
    .event-line,
    .item-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .topbar {
      min-height: 46px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }
    .topbar-title {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
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
    .secret-wrap {
      width: min(260px, 34vw);
    }
    .content {
      margin-top: 18px;
      display: grid;
      gap: 22px;
    }
    [data-panel] {
      display: none;
    }
    [data-panel].active {
      display: grid;
      gap: 22px;
    }
    .section {
      border-top: 1px solid var(--line);
      padding-top: 16px;
      min-width: 0;
    }
    .section:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .section-head {
      margin-bottom: 12px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, .72fr);
      gap: 22px;
      align-items: start;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      align-items: end;
    }
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      align-items: end;
    }
    .composer {
      display: grid;
      gap: 12px;
    }
    .message-field textarea {
      min-height: 220px;
    }
    .actions {
      justify-content: flex-end;
    }
    .overview {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 18px;
    }
    .metric {
      min-width: 0;
      border-top: 1px solid var(--line);
      padding-top: 10px;
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
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .empty {
      color: var(--muted);
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .item {
      border-top: 1px solid var(--line);
      padding: 10px 0 12px;
    }
    .item:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .item strong {
      font-weight: 620;
    }
    .item-meta,
    .subtle {
      color: var(--muted);
    }
    .item-meta {
      margin-top: 4px;
      overflow-wrap: anywhere;
    }
    .check-row {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .check-row label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      color: var(--text);
      font-size: 13px;
    }
    .result-box {
      display: none;
    }
    .events {
      display: grid;
      gap: 8px;
      max-height: 420px;
      overflow: auto;
      padding-right: 2px;
    }
    .event {
      border-top: 1px solid var(--line);
      padding-top: 9px;
    }
    .event:first-child {
      border-top: 0;
      padding-top: 0;
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
    .kv {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 7px 12px;
      color: var(--muted);
    }
    .kv strong {
      color: var(--text);
      font-weight: 540;
      overflow-wrap: anywhere;
    }
    .count {
      color: inherit;
      opacity: .72;
      font-size: 12px;
    }
    @media (max-width: 980px) {
      .app {
        grid-template-columns: 1fr;
      }
      .sidebar {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
      .nav {
        display: flex;
        overflow-x: auto;
        padding-bottom: 2px;
      }
      .nav-item {
        width: auto;
      }
      .main {
        padding: 16px 18px 44px;
      }
      .grid-2,
      .grid-3,
      .grid-4,
      .overview {
        grid-template-columns: 1fr;
      }
      .secret-wrap {
        width: 100%;
      }
      .topbar {
        display: grid;
        align-items: start;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <h1>Dragon</h1>
        <p>Gateway</p>
      </div>
      <nav class="nav" aria-label="Dashboard views">
        <button class="nav-item" data-tab="run" aria-selected="true">Run <span id="runCount" class="count">0</span></button>
        <button class="nav-item" data-tab="models" aria-selected="false">Models <span id="modelConfigCount" class="count">0</span></button>
        <button class="nav-item" data-tab="agents" aria-selected="false">Agents <span id="agentProfileCount" class="count">0</span></button>
        <button class="nav-item" data-tab="observe" aria-selected="false">Observe <span id="eventCount" class="count">0</span></button>
        <button class="nav-item" data-tab="system" aria-selected="false">System</button>
      </nav>
    </aside>

    <main class="main">
      <div class="topbar">
        <div class="topbar-title">
          <div class="status"><span id="healthDot" class="dot"></span><span id="healthText">checking</span></div>
          <span class="subtle" id="eventStatus">connecting</span>
        </div>
        <div class="secret-wrap">
          <label for="secret">Shared Secret</label>
          <input id="secret" type="password" autocomplete="off" placeholder="optional">
        </div>
      </div>

      <div class="content">
        <section id="runPanel" class="active" data-panel="run">
          <div class="grid-2">
            <div class="section">
              <div class="section-head">
                <h2>Run</h2>
                <button id="sendBtn">Send</button>
              </div>
              <div class="composer">
                <div class="grid-4">
                  <div>
                    <label for="runProfile">Profile</label>
                    <select id="runProfile"></select>
                  </div>
                  <div>
                    <label for="sessionId">Session</label>
                    <input id="sessionId" value="dashboard" autocomplete="off">
                  </div>
                  <div>
                    <label for="model">Model</label>
                    <input id="model" list="modelSuggestions" autocomplete="off" placeholder="optional">
                    <datalist id="modelSuggestions"></datalist>
                  </div>
                  <div>
                    <label for="thinking">Thinking</label>
                    <select id="thinking">
                      <option value="">Default</option>
                      <option value="none">None</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label for="workspace">Workspace</label>
                  <input id="workspace" autocomplete="off" placeholder="optional">
                </div>
                <div class="message-field">
                  <label for="message">Message</label>
                  <textarea id="message"></textarea>
                </div>
                <pre id="runOutput" class="result-box"></pre>
              </div>
            </div>
            <div class="section">
              <div class="overview">
                <div class="metric"><span>Runs</span><strong id="metricRuns">0</strong></div>
                <div class="metric"><span>Active</span><strong id="metricActive">0</strong></div>
                <div class="metric"><span>Providers</span><strong id="metricProviders">0</strong></div>
                <div class="metric"><span>Plugins</span><strong id="metricPlugins">0</strong></div>
                <div class="metric"><span>Tools</span><strong id="metricTools">0</strong></div>
              </div>
              <div class="section" style="margin-top:18px;">
                <div class="section-head">
                  <h2>Recent Runs</h2>
                  <button id="refreshRunsBtn" class="secondary">Refresh</button>
                </div>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>State</th><th>Run</th><th>Preview</th><th></th></tr></thead>
                    <tbody id="runsBody"></tbody>
                  </table>
                </div>
                <div id="runsEmpty" class="empty">No runs yet.</div>
              </div>
            </div>
          </div>
        </section>

        <section id="modelsPanel" data-panel="models">
          <div class="section">
            <div class="section-head">
              <h2>Models</h2>
              <div class="right-actions">
                <button id="refreshModelConfigBtn" class="secondary">Refresh</button>
                <button id="saveModelConfigBtn">Save</button>
              </div>
            </div>
            <div class="grid-2">
              <div>
                <div class="grid-3">
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
                </div>
                <div class="check-row" style="margin-top:12px;">
                  <label><input id="modelProviderEnabled" type="checkbox" checked> Enabled</label>
                  <label><input id="modelProviderTools" type="checkbox" checked> Tool Calling</label>
                  <button id="upsertModelProviderBtn">Add / Update</button>
                  <button id="clearModelProviderBtn" class="secondary">Clear</button>
                </div>
                <pre id="modelConfigResult" class="result-box"></pre>
              </div>
              <div>
                <div class="section-head">
                  <h2>Configured</h2>
                  <span id="modelConfigPath" class="subtle"></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Provider</th><th>Type</th><th>Model</th><th>Key</th><th></th></tr></thead>
                    <tbody id="modelConfigBody"></tbody>
                  </table>
                </div>
                <div id="modelConfigEmpty" class="empty">No model providers configured.</div>
              </div>
            </div>
          </div>
          <div class="section">
            <div class="section-head">
              <h2>Loaded Providers</h2>
              <button id="refreshProvidersBtn" class="secondary">Refresh</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Provider</th><th>Default Model</th><th>Models</th><th>Tools</th></tr></thead>
                <tbody id="providersBody"></tbody>
              </table>
            </div>
            <div id="providersEmpty" class="empty">No providers loaded.</div>
          </div>
        </section>

        <section id="agentsPanel" data-panel="agents">
          <div class="section">
            <div class="section-head">
              <h2>Agents</h2>
              <div class="right-actions">
                <button id="refreshAgentConfigBtn" class="secondary">Refresh</button>
                <button id="saveAgentConfigBtn">Save</button>
              </div>
            </div>
            <div class="grid-2">
              <div>
                <div class="grid-3">
                  <div>
                    <label for="agentProfileId">Profile ID</label>
                    <input id="agentProfileId" autocomplete="off" placeholder="default">
                  </div>
                  <div>
                    <label for="agentProfileName">Name</label>
                    <input id="agentProfileName" autocomplete="off" placeholder="Default Agent">
                  </div>
                  <div>
                    <label for="agentProfileModel">Default Model</label>
                    <input id="agentProfileModel" list="modelSuggestions" autocomplete="off" placeholder="optional">
                  </div>
                  <div>
                    <label for="agentProfileWorkspace">Workspace</label>
                    <input id="agentProfileWorkspace" autocomplete="off" placeholder="optional">
                  </div>
                  <div>
                    <label for="agentProfileThinking">Thinking</label>
                    <select id="agentProfileThinking">
                      <option value="">Default</option>
                      <option value="none">None</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label for="agentProfileDefault">Default</label>
                    <input id="agentProfileDefault" type="checkbox">
                  </div>
                </div>
                <div style="margin-top:12px;">
                  <label for="agentProfileDescription">Description</label>
                  <input id="agentProfileDescription" autocomplete="off" placeholder="optional">
                </div>
                <div style="margin-top:12px;">
                  <label for="agentProfilePrompt">Instructions</label>
                  <textarea id="agentProfilePrompt"></textarea>
                </div>
                <div class="check-row" style="margin-top:12px;">
                  <label><input id="agentProfileMemory" type="checkbox" checked> Memory</label>
                  <label><input id="agentProfileTools" type="checkbox" checked> Tools</label>
                  <button id="upsertAgentProfileBtn">Add / Update</button>
                  <button id="clearAgentProfileBtn" class="secondary">Clear</button>
                </div>
                <pre id="agentConfigResult" class="result-box"></pre>
              </div>
              <div>
                <div class="section-head">
                  <h2>Profiles</h2>
                  <span id="agentConfigPath" class="subtle"></span>
                </div>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Profile</th><th>Model</th><th>Workspace</th><th></th></tr></thead>
                    <tbody id="agentProfilesBody"></tbody>
                  </table>
                </div>
                <div id="agentProfilesEmpty" class="empty">No agent profiles configured.</div>
              </div>
            </div>
          </div>
        </section>

        <section id="observePanel" data-panel="observe">
          <div class="section">
            <div class="section-head">
              <h2>Runs</h2>
              <button id="refreshRunsObserveBtn" class="secondary">Refresh</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>State</th><th>Run</th><th>Preview</th><th></th></tr></thead>
                <tbody id="runsObserveBody"></tbody>
              </table>
            </div>
            <div id="runsObserveEmpty" class="empty">No runs yet.</div>
          </div>
          <div class="grid-2">
            <div class="section">
              <div class="section-head">
                <h2>Events</h2>
                <button id="reconnectBtn" class="secondary">Reconnect</button>
              </div>
              <div id="events" class="events"></div>
            </div>
            <div class="section">
              <div class="section-head">
                <h2>Memory</h2>
                <button id="refreshMemoryBtn" class="secondary">Refresh</button>
              </div>
              <div id="memoryCandidates"></div>
              <div id="memoryEmpty" class="empty">No pending memory candidates.</div>
              <pre id="memoryResult" class="result-box"></pre>
            </div>
          </div>
          <div class="section">
            <div class="section-head">
              <h2>Trajectory</h2>
              <button id="refreshTrajectoryBtn" class="secondary">Refresh</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Status</th><th>Run</th><th>Prompt</th><th></th></tr></thead>
                <tbody id="trajectoryBody"></tbody>
              </table>
            </div>
            <div id="trajectoryEmpty" class="empty">No trajectory for this session.</div>
            <pre id="trajectoryDetail" class="result-box"></pre>
          </div>
        </section>

        <section id="systemPanel" data-panel="system">
          <div class="grid-2">
            <div class="section">
              <div class="section-head">
                <h2>Gateway</h2>
                <button id="refreshHealthBtn" class="secondary">Refresh</button>
              </div>
              <div class="kv" id="healthDetails"></div>
            </div>
            <div class="section">
              <div class="section-head">
                <h2>Cron</h2>
                <div class="right-actions">
                  <button id="tickCronBtn" class="secondary">Tick</button>
                  <button id="refreshCronBtn" class="secondary">Refresh</button>
                </div>
              </div>
              <div class="grid-3">
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
              </div>
              <div style="margin-top:12px;">
                <label for="cronMessage">Message</label>
                <input id="cronMessage" autocomplete="off" placeholder="Run scheduled task">
              </div>
              <div class="check-row" style="margin-top:12px;">
                <label><input id="cronEnabled" type="checkbox" checked> Enabled</label>
                <button id="saveCronBtn">Save Job</button>
              </div>
              <div class="table-wrap" style="margin-top:12px;">
                <table>
                  <thead><tr><th>Job</th><th>Schedule</th><th>Next</th><th></th></tr></thead>
                  <tbody id="cronBody"></tbody>
                </table>
              </div>
              <div id="cronEmpty" class="empty">No cron jobs configured.</div>
              <pre id="cronResult" class="result-box"></pre>
            </div>
          </div>
          <div class="grid-2">
            <div class="section">
              <div class="section-head">
                <h2>Plugins</h2>
                <button id="refreshPluginsBtn" class="secondary">Refresh</button>
              </div>
              <div id="plugins"></div>
              <div id="pluginsEmpty" class="empty">No plugins loaded.</div>
            </div>
            <div class="section">
              <div class="section-head">
                <h2>Tools</h2>
                <button id="refreshToolsBtn" class="secondary">Refresh</button>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Tool</th><th>Access</th><th></th></tr></thead>
                  <tbody id="toolsBody"></tbody>
                </table>
              </div>
              <div id="toolsEmpty" class="empty">No tools available.</div>
              <pre id="toolResult" class="result-box"></pre>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>

  <script>
    const state = {
      activeTab: "run",
      eventController: null,
      eventGeneration: 0,
      reconnectTimer: 0,
      events: [],
      runs: [],
      trajectories: [],
      providers: [],
      modelConfig: { providers: [], appliesOn: "restart" },
      editingModelProviderId: "",
      agentConfig: { profiles: [] },
      editingAgentProfileId: "",
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
      refreshAllProtected();
      connectEvents();
    });

    document.querySelectorAll("[data-tab]").forEach(button => {
      button.addEventListener("click", () => setTab(button.getAttribute("data-tab")));
    });

    $("sendBtn").addEventListener("click", sendRun);
    $("runProfile").addEventListener("change", applySelectedAgentProfile);
    $("refreshRunsBtn").addEventListener("click", refreshRuns);
    $("refreshRunsObserveBtn").addEventListener("click", refreshRuns);
    $("refreshTrajectoryBtn").addEventListener("click", refreshTrajectories);
    $("refreshProvidersBtn").addEventListener("click", refreshProviders);
    $("refreshModelConfigBtn").addEventListener("click", refreshModelConfig);
    $("saveModelConfigBtn").addEventListener("click", saveModelConfig);
    $("upsertModelProviderBtn").addEventListener("click", upsertModelProviderConfig);
    $("clearModelProviderBtn").addEventListener("click", clearModelProviderForm);
    $("refreshAgentConfigBtn").addEventListener("click", refreshAgentConfig);
    $("saveAgentConfigBtn").addEventListener("click", saveAgentConfig);
    $("upsertAgentProfileBtn").addEventListener("click", upsertAgentProfile);
    $("clearAgentProfileBtn").addEventListener("click", clearAgentProfileForm);
    $("refreshPluginsBtn").addEventListener("click", refreshPlugins);
    $("refreshToolsBtn").addEventListener("click", refreshTools);
    $("refreshMemoryBtn").addEventListener("click", refreshMemoryCandidates);
    $("refreshCronBtn").addEventListener("click", refreshCronJobs);
    $("saveCronBtn").addEventListener("click", saveCronJob);
    $("tickCronBtn").addEventListener("click", tickCron);
    $("refreshHealthBtn").addEventListener("click", refreshHealth);
    $("reconnectBtn").addEventListener("click", connectEvents);

    function setTab(tab) {
      state.activeTab = tab || "run";
      document.querySelectorAll("[data-tab]").forEach(button => {
        button.setAttribute("aria-selected", button.getAttribute("data-tab") === state.activeTab ? "true" : "false");
      });
      document.querySelectorAll("[data-panel]").forEach(panel => {
        panel.classList.toggle("active", panel.getAttribute("data-panel") === state.activeTab);
      });
      if (state.activeTab === "run") refreshRuns();
      if (state.activeTab === "models") {
        refreshModelConfig();
        refreshProviders();
      }
      if (state.activeTab === "agents") refreshAgentConfig();
      if (state.activeTab === "observe") {
        refreshRuns();
        refreshTrajectories();
        refreshMemoryCandidates();
      }
      if (state.activeTab === "system") {
        refreshHealth();
        refreshPlugins();
        refreshTools();
        refreshCronJobs();
      }
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

    function refreshAllProtected() {
      refreshHealth();
      refreshRuns();
      refreshProviders();
      refreshModelConfig();
      refreshAgentConfig();
      refreshPlugins();
      refreshTools();
      refreshMemoryCandidates();
      refreshCronJobs();
      refreshTrajectories();
    }

    async function refreshHealth() {
      try {
        const response = await fetch("/health", { headers: authHeaders() });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "health failed");
        $("healthDot").className = "dot ok";
        $("healthText").textContent = "online";
        renderHealth(json);
      } catch {
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
      const rawMessage = $("message").value.trim();
      if (!rawMessage) return;
      $("sendBtn").disabled = true;
      $("runOutput").style.display = "block";
      $("runOutput").textContent = "running...";
      try {
        const profile = selectedAgentProfile();
        const params = {
          sessionId: $("sessionId").value.trim() || "dashboard",
          message: profile?.systemPrompt ? profile.systemPrompt + "\\n\\n" + rawMessage : rawMessage,
          source: "web",
          metadata: profile ? { agentProfileId: profile.id } : { source: "dashboard" },
        };
        const workspace = $("workspace").value.trim() || profile?.workspace || "";
        if (workspace) params.workspace = workspace;
        const model = $("model").value.trim() || profile?.defaultModel || "";
        if (model) params.model = model;
        const thinking = $("thinking").value.trim() || profile?.thinking || "";
        if (thinking) params.thinking = thinking;
        const payload = await rpc("agent", params);
        const assistant = [...(payload.result?.messages || [])].reverse().find(message => message.role === "assistant");
        $("runOutput").textContent = assistant?.content || JSON.stringify(payload.result, null, 2);
        $("message").value = "";
        await refreshRuns();
      } catch (error) {
        $("runOutput").textContent = error.message || String(error);
        pushLocalEvent("error", error.message || String(error));
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
        showResult("modelConfigResult", error.message || String(error));
      }
    }

    async function refreshAgentConfig() {
      try {
        const payload = await rpc("agent.config.get");
        state.agentConfig = {
          profiles: payload.profiles || [],
          defaultProfileId: payload.defaultProfileId || "",
          configPath: payload.configPath || "",
        };
        renderAgentConfig();
      } catch (error) {
        state.agentConfig = { profiles: [] };
        renderAgentConfig();
        showResult("agentConfigResult", error.message || String(error));
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
      showResult("modelConfigResult", "saving...");
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
        showResult("modelConfigResult", "saved; restart required");
        await refreshProviders();
      } catch (error) {
        showResult("modelConfigResult", error.message || String(error));
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

    async function saveAgentConfig() {
      showResult("agentConfigResult", "saving...");
      try {
        const payload = await rpc("agent.config.save", {
          profiles: state.agentConfig.profiles || [],
          defaultProfileId: state.agentConfig.defaultProfileId || undefined,
        });
        state.agentConfig = {
          profiles: payload.profiles || [],
          defaultProfileId: payload.defaultProfileId || "",
          configPath: payload.configPath || "",
        };
        renderAgentConfig();
        showResult("agentConfigResult", "saved");
      } catch (error) {
        showResult("agentConfigResult", error.message || String(error));
      }
    }

    function upsertAgentProfile() {
      const id = $("agentProfileId").value.trim();
      const name = $("agentProfileName").value.trim();
      if (!id || !name) return;
      const profile = {
        id,
        name,
        memoryEnabled: $("agentProfileMemory").checked,
        toolsEnabled: $("agentProfileTools").checked,
      };
      const description = $("agentProfileDescription").value.trim();
      const defaultModel = $("agentProfileModel").value.trim();
      const workspace = $("agentProfileWorkspace").value.trim();
      const thinking = $("agentProfileThinking").value.trim();
      const systemPrompt = $("agentProfilePrompt").value.trim();
      if (description) profile.description = description;
      if (defaultModel) profile.defaultModel = defaultModel;
      if (workspace) profile.workspace = workspace;
      if (thinking) profile.thinking = thinking;
      if (systemPrompt) profile.systemPrompt = systemPrompt;

      const next = (state.agentConfig.profiles || [])
        .filter(item => item.id !== id && item.id !== state.editingAgentProfileId);
      next.push(profile);
      state.agentConfig = {
        ...state.agentConfig,
        profiles: next.sort((left, right) => String(left.id).localeCompare(String(right.id))),
        defaultProfileId: $("agentProfileDefault").checked ? id : state.agentConfig.defaultProfileId,
      };
      if (state.agentConfig.defaultProfileId && !state.agentConfig.profiles.some(item => item.id === state.agentConfig.defaultProfileId)) {
        state.agentConfig.defaultProfileId = "";
      }
      clearAgentProfileForm();
      renderAgentConfig();
    }

    function clearAgentProfileForm() {
      state.editingAgentProfileId = "";
      $("agentProfileId").value = "";
      $("agentProfileName").value = "";
      $("agentProfileDescription").value = "";
      $("agentProfileModel").value = "";
      $("agentProfileWorkspace").value = "";
      $("agentProfileThinking").value = "";
      $("agentProfilePrompt").value = "";
      $("agentProfileMemory").checked = true;
      $("agentProfileTools").checked = true;
      $("agentProfileDefault").checked = false;
    }

    function editAgentProfile(id) {
      const profile = (state.agentConfig.profiles || []).find(item => item.id === id);
      if (!profile) return;
      state.editingAgentProfileId = profile.id || "";
      $("agentProfileId").value = profile.id || "";
      $("agentProfileName").value = profile.name || "";
      $("agentProfileDescription").value = profile.description || "";
      $("agentProfileModel").value = profile.defaultModel || "";
      $("agentProfileWorkspace").value = profile.workspace || "";
      $("agentProfileThinking").value = profile.thinking || "";
      $("agentProfilePrompt").value = profile.systemPrompt || "";
      $("agentProfileMemory").checked = profile.memoryEnabled !== false;
      $("agentProfileTools").checked = profile.toolsEnabled !== false;
      $("agentProfileDefault").checked = state.agentConfig.defaultProfileId === profile.id;
    }

    function removeAgentProfile(id) {
      state.agentConfig = {
        ...state.agentConfig,
        profiles: (state.agentConfig.profiles || []).filter(item => item.id !== id),
        defaultProfileId: state.agentConfig.defaultProfileId === id ? "" : state.agentConfig.defaultProfileId,
      };
      if (state.editingAgentProfileId === id) {
        clearAgentProfileForm();
      }
      renderAgentConfig();
    }

    function selectedAgentProfile() {
      const id = $("runProfile").value;
      return (state.agentConfig.profiles || []).find(profile => profile.id === id);
    }

    function applySelectedAgentProfile() {
      const profile = selectedAgentProfile();
      if (!profile) return;
      if (profile.defaultModel) $("model").value = profile.defaultModel;
      if (profile.workspace) $("workspace").value = profile.workspace;
      $("thinking").value = profile.thinking || "";
    }

    async function saveCronJob() {
      const id = $("cronId").value.trim();
      const schedule = $("cronSchedule").value.trim();
      const sessionId = $("cronSession").value.trim();
      const message = $("cronMessage").value.trim();
      if (!id || !schedule || !sessionId || !message) return;
      showResult("cronResult", "saving...");
      try {
        const payload = await rpc("cron.job.upsert", {
          id,
          schedule,
          sessionId,
          message,
          enabled: $("cronEnabled").checked,
          metadata: { source: "dashboard" },
        });
        showResult("cronResult", JSON.stringify(payload.job, null, 2));
        await refreshCronJobs();
      } catch (error) {
        showResult("cronResult", error.message || String(error));
      }
    }

    async function removeCronJob(id) {
      showResult("cronResult", "removing...");
      try {
        const payload = await rpc("cron.job.remove", { id });
        showResult("cronResult", JSON.stringify(payload, null, 2));
        await refreshCronJobs();
      } catch (error) {
        showResult("cronResult", error.message || String(error));
      }
    }

    function editCronJob(id) {
      const job = state.cronJobs.find(item => item.id === id);
      if (!job) return;
      $("cronId").value = job.id || "";
      $("cronSchedule").value = job.schedule || "";
      $("cronSession").value = job.sessionId || "";
      $("cronMessage").value = job.message || "";
      $("cronEnabled").checked = job.enabled !== false;
    }

    async function tickCron() {
      showResult("cronResult", "ticking...");
      try {
        const payload = await rpc("cron.tick");
        showResult("cronResult", JSON.stringify(payload, null, 2));
        await refreshCronJobs();
      } catch (error) {
        showResult("cronResult", error.message || String(error));
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
      showResult("toolResult", "running " + toolName + "...");
      try {
        const payload = await rpc("tool.invoke", params);
        showResult("toolResult", JSON.stringify(payload, null, 2));
      } catch (error) {
        showResult("toolResult", error.message || String(error));
      }
    }

    function defaultToolInput(toolName) {
      if (toolName === "git_status") return { porcelain: false };
      if (toolName === "git_diff") return { stat: true, maxChars: 20000 };
      if (toolName === "git_log") return { limit: 10, maxChars: 20000 };
      return {};
    }

    async function promoteMemoryCandidate(id) {
      showResult("memoryResult", "promoting...");
      try {
        const payload = await rpc("memory.candidate.promote", { id, source: "dashboard" });
        showResult("memoryResult", JSON.stringify(payload.output, null, 2));
        await refreshMemoryCandidates();
      } catch (error) {
        showResult("memoryResult", error.message || String(error));
      }
    }

    async function rejectMemoryCandidate(id) {
      showResult("memoryResult", "rejecting...");
      try {
        const payload = await rpc("memory.candidate.reject", { id, reason: "Rejected from dashboard." });
        showResult("memoryResult", JSON.stringify(payload.output, null, 2));
        await refreshMemoryCandidates();
      } catch (error) {
        showResult("memoryResult", error.message || String(error));
      }
    }

    async function loadTrajectory(runId) {
      try {
        const payload = await rpc("trajectory.get", {
          sessionId: $("sessionId").value.trim() || "dashboard",
          runId,
          maxEvents: 80,
        });
        showResult("trajectoryDetail", JSON.stringify(payload.record, null, 2));
      } catch (error) {
        showResult("trajectoryDetail", error.message || String(error));
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
      const html = state.runs.map(run => renderRunRow(run)).join("");
      $("runsBody").innerHTML = html;
      $("runsObserveBody").innerHTML = html;
      $("runsEmpty").style.display = state.runs.length ? "none" : "block";
      $("runsObserveEmpty").style.display = state.runs.length ? "none" : "block";
      document.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", () => cancelRun(button.getAttribute("data-cancel")));
      });
      renderMetrics();
    }

    function renderRunRow(run) {
      const canCancel = run.state === "running" || run.state === "cancelling";
      const stateClass = "state-" + escapeHtml(run.state || "");
      return "<tr>" +
        "<td class='" + stateClass + "'>" + escapeHtml(run.state || "") + "</td>" +
        "<td><code>" + escapeHtml(shortId(run.runId)) + "</code><br><span class='subtle'>" + escapeHtml(run.sessionId || "") + "</span></td>" +
        "<td>" + escapeHtml(run.result?.assistantPreview || run.messagePreview || run.error || "") + "</td>" +
        "<td>" + (canCancel ? "<button class='danger' data-cancel='" + escapeHtml(run.runId) + "'>Cancel</button>" : "") + "</td>" +
        "</tr>";
    }

    function renderTrajectories() {
      $("trajectoryBody").innerHTML = state.trajectories.map(item => {
        const statusClass = "state-" + escapeHtml(item.status || "");
        return "<tr>" +
          "<td class='" + statusClass + "'>" + escapeHtml(item.status || "") + "</td>" +
          "<td><code>" + escapeHtml(shortId(item.runId)) + "</code><br><span class='subtle'>" + escapeHtml(formatTime(item.createdAt)) + "</span></td>" +
          "<td>" + escapeHtml(item.userPreview || "") + "</td>" +
          "<td><button class='secondary' data-trajectory='" + escapeHtml(item.runId) + "'>View</button></td>" +
          "</tr>";
      }).join("");
      $("trajectoryEmpty").style.display = state.trajectories.length ? "none" : "block";
      document.querySelectorAll("[data-trajectory]").forEach(button => {
        button.addEventListener("click", () => loadTrajectory(button.getAttribute("data-trajectory")));
      });
    }

    function renderPlugins() {
      $("metricPlugins").textContent = String(state.plugins.length);
      $("pluginsEmpty").style.display = state.plugins.length ? "none" : "block";
      $("plugins").innerHTML = state.plugins.map(plugin => {
        const tools = (plugin.tools || []).map(tool => tool.name + (tool.permission ? ":" + tool.permission : "")).join(", ");
        const providers = (plugin.providers || []).map(provider => provider.displayName && provider.displayName !== provider.id ? provider.id + " (" + provider.displayName + ")" : provider.id).join(", ");
        const memoryBackends = (plugin.memoryBackends || []).map(backend => backend.displayName && backend.displayName !== backend.id ? backend.id + " (" + backend.displayName + ")" : backend.id).join(", ");
        const hooks = (plugin.lifecycleHooks || []).join(", ");
        const details = [
          plugin.description || "",
          tools ? "tools: " + tools : "",
          providers ? "providers: " + providers : "",
          memoryBackends ? "memory: " + memoryBackends : "",
          hooks ? "hooks: " + hooks : "",
        ].filter(Boolean).join("\\n");
        const counts = (plugin.tools || []).length + " tools / " + (plugin.providers || []).length + " providers / " + (plugin.memoryBackends || []).length + " memory";
        return "<div class='item'>" +
          "<div class='item-title'><strong>" + escapeHtml(plugin.name || "") + "</strong><span class='subtle'>" + escapeHtml(plugin.version || "") + "</span></div>" +
          "<div class='item-meta'>" + escapeHtml(counts) + "</div>" +
          (details ? "<pre>" + escapeHtml(details) + "</pre>" : "") +
        "</div>";
      }).join("");
    }

    function renderProviders() {
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
        const apiKey = provider.apiKeyConfigured || provider.apiKey ? "configured" : "missing";
        return "<tr>" +
          "<td><strong>" + escapeHtml(provider.id || "") + "</strong>" + (meta ? "<pre>" + escapeHtml(meta) + "</pre>" : "") + "</td>" +
          "<td>" + escapeHtml(provider.type || "") + "</td>" +
          "<td>" + escapeHtml(provider.defaultModel || "") + "</td>" +
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

    function renderAgentConfig() {
      const profiles = state.agentConfig.profiles || [];
      $("agentProfileCount").textContent = String(profiles.length);
      $("agentProfilesEmpty").style.display = profiles.length ? "none" : "block";
      $("agentConfigPath").textContent = state.agentConfig.configPath || "";
      $("runProfile").innerHTML = "<option value=''>Default</option>" + profiles.map(profile => {
        const suffix = state.agentConfig.defaultProfileId === profile.id ? " *" : "";
        return "<option value='" + escapeHtml(profile.id || "") + "'>" + escapeHtml((profile.name || profile.id || "") + suffix) + "</option>";
      }).join("");
      if (state.agentConfig.defaultProfileId && !$("runProfile").value) {
        $("runProfile").value = state.agentConfig.defaultProfileId;
        applySelectedAgentProfile();
      }
      $("agentProfilesBody").innerHTML = profiles.map(profile => {
        const meta = [
          state.agentConfig.defaultProfileId === profile.id ? "default" : "",
          profile.thinking ? "thinking: " + profile.thinking : "",
          profile.memoryEnabled === false ? "memory off" : "",
          profile.toolsEnabled === false ? "tools off" : "",
          profile.description || "",
        ].filter(Boolean).join("\\n");
        return "<tr>" +
          "<td><strong>" + escapeHtml(profile.name || profile.id || "") + "</strong><br><code>" + escapeHtml(profile.id || "") + "</code>" + (meta ? "<pre>" + escapeHtml(meta) + "</pre>" : "") + "</td>" +
          "<td>" + escapeHtml(profile.defaultModel || "") + "</td>" +
          "<td>" + escapeHtml(profile.workspace || "") + "</td>" +
          "<td><div class='right-actions'>" +
            "<button class='secondary' data-edit-agent-profile='" + escapeHtml(profile.id || "") + "'>Edit</button>" +
            "<button class='danger' data-remove-agent-profile='" + escapeHtml(profile.id || "") + "'>Remove</button>" +
          "</div></td>" +
          "</tr>";
      }).join("");
      document.querySelectorAll("[data-edit-agent-profile]").forEach(button => {
        button.addEventListener("click", () => editAgentProfile(button.getAttribute("data-edit-agent-profile")));
      });
      document.querySelectorAll("[data-remove-agent-profile]").forEach(button => {
        button.addEventListener("click", () => removeAgentProfile(button.getAttribute("data-remove-agent-profile")));
      });
    }

    function renderTools() {
      $("metricTools").textContent = String(state.tools.length);
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
      $("memoryEmpty").style.display = state.memoryCandidates.length ? "none" : "block";
      const promoteAttrs = state.memoryReview.canPromote ? "" : " disabled title='Requires write permission'";
      const rejectAttrs = state.memoryReview.canReject ? "" : " disabled title='Requires write permission'";
      $("memoryCandidates").innerHTML = state.memoryCandidates.map(candidate => {
        const meta = [
          candidate.scope || "",
          candidate.sessionId ? "session " + shortId(candidate.sessionId) : "",
          candidate.createdAt ? formatTime(candidate.createdAt) : "",
        ].filter(Boolean).join(" / ");
        return "<div class='item'>" +
          "<div><strong>" + escapeHtml(candidate.content || "") + "</strong></div>" +
          "<div class='item-meta'>" + escapeHtml(meta) + "</div>" +
          (candidate.reason ? "<pre>" + escapeHtml(candidate.reason) + "</pre>" : "") +
          "<div class='right-actions' style='margin-top:8px;'>" +
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
        while ((split = buffer.indexOf("\\n\\n")) !== -1) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          handleSseBlock(raw);
        }
      }
    }

    function handleSseBlock(raw) {
      if (!raw || raw.startsWith(":")) return;
      const lines = raw.split(/\\r?\\n/);
      const name = (lines.find(line => line.startsWith("event: ")) || "event: message").slice(7);
      const data = lines.filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\\n");
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
      $("metricTools").textContent = String(state.tools.length);
    }

    function showResult(id, text) {
      $(id).style.display = "block";
      $(id).textContent = text;
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

    refreshAllProtected();
    connectEvents();
    setInterval(refreshHealth, 5000);
    setInterval(refreshRuns, 8000);
    setInterval(refreshProviders, 15000);
    setInterval(refreshPlugins, 15000);
    setInterval(refreshTools, 15000);
    setInterval(refreshMemoryCandidates, 15000);
    setInterval(refreshCronJobs, 15000);
  </script>
</body>
</html>`;
}
