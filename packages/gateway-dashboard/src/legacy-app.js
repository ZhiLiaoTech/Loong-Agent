
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
      activeRunId: "",
      expectingRun: false,
      streamBuffer: "",
      chatTurns: [],
    };

    const MAX_CHAT_TURNS = 80;

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
    const toggleRawBtn = $("toggleRawBtn");
    if (toggleRawBtn) {
      toggleRawBtn.addEventListener("click", () => $("runOutput").classList.toggle("collapsed"));
    }
    const themeBtn = $("themeBtn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        document.documentElement.dataset.theme =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      });
    }
    const menuBtn = $("menuBtn");
    if (menuBtn) {
      menuBtn.addEventListener("click", () => document.body.classList.toggle("nav-open"));
    }

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

    async function refreshAuthBanner() {
      const banner = $("authBanner");
      if (!banner) return;
      try {
        const response = await fetch("/health");
        if (response.status === 401) {
          banner.textContent =
            "Authentication required. Enter the gateway shared secret above to use RPC and streaming.";
          banner.classList.remove("hidden");
          return;
        }
        banner.classList.add("hidden");
      } catch {
        banner.classList.add("hidden");
      }
    }

    async function refreshHealth() {
      try {
        const response = await fetch("/health", { headers: authHeaders() });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "health failed");
        $("healthDot").className = "dot ok";
        $("healthText").textContent = "online";
        renderHealth(json);
        $("authBanner")?.classList.add("hidden");
      } catch {
        $("healthDot").className = "dot warn";
        $("healthText").textContent = "offline";
        $("healthDetails").innerHTML = "";
        await refreshAuthBanner();
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
      if (!rawMessage || state.expectingRun) return;
      $("sendBtn").disabled = true;
      state.expectingRun = true;
      state.activeRunId = "";
      state.streamBuffer = "";
      state.chatTurns.push({ role: "user", text: rawMessage, streaming: false });
      trimChatTurns();
      renderChatTranscript();
      $("runOutput").style.display = "block";
      $("runOutput").textContent = "running...";
      try {
        const profile = selectedAgentProfile();
        const params = {
          sessionId: $("sessionId").value.trim() || "dashboard",
          message: rawMessage,
          source: "web",
          metadata: { source: "dashboard" },
        };
        if (profile?.id) params.profileId = profile.id;
        if (profile?.systemPrompt) params.systemPrompt = profile.systemPrompt;
        if (profile?.toolsEnabled === false) params.toolsEnabled = false;
        if (profile?.memoryEnabled === false) params.memoryEnabled = false;
        const workspace = $("workspace").value.trim() || profile?.workspace || "";
        if (workspace) params.workspace = workspace;
        const model = $("model").value.trim() || profile?.defaultModel || "";
        if (model) params.model = model;
        const thinking = $("thinking").value.trim() || profile?.thinking || "";
        if (thinking) params.thinking = thinking;
        state.chatTurns.push({ role: "assistant", text: "", streaming: true });
        trimChatTurns();
        renderChatTranscript();
        const payload = await rpc("agent", params);
        if (payload.result?.runId) {
          bindActiveRun(payload.result.runId);
        }
        const assistant = [...(payload.result?.messages || [])].reverse().find(message => message.role === "assistant");
        finalizeAssistant(assistant?.content || state.streamBuffer || "");
        $("runOutput").textContent = JSON.stringify(payload.result, null, 2);
        $("message").value = "";
        await refreshRuns();
      } catch (error) {
        state.expectingRun = false;
        finalizeAssistant("Error: " + (error.message || String(error)));
        $("runOutput").textContent = error.message || String(error);
        pushLocalEvent("error", error.message || String(error));
      } finally {
        $("sendBtn").disabled = false;
        if (!state.activeRunId) {
          state.expectingRun = false;
        }
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
        ].filter(Boolean).join("\n");
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
        }).join("\n");
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
        ].filter(Boolean).join("\n");
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
        ].filter(Boolean).join("\n");
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
        ].filter(Boolean).join("\n");
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
          handleRunStreamEvent(parsed.event || {});
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


    function bindActiveRun(runId) {
      if (!runId) return;
      state.activeRunId = runId;
      state.expectingRun = false;
    }

    function handleRunStreamEvent(ev) {
      if (ev.type === "lifecycle" && ev.phase === "start" && state.expectingRun && ev.runId) {
        bindActiveRun(ev.runId);
      }
      if (ev.type === "assistant_delta" && ev.text && state.activeRunId && ev.runId === state.activeRunId) {
        state.streamBuffer += ev.text;
        appendChatDelta(ev.text);
      }
      if (
        ev.type === "lifecycle"
        && state.activeRunId
        && ev.runId === state.activeRunId
        && ["end", "error", "cancelled"].includes(ev.phase)
      ) {
        const last = state.chatTurns[state.chatTurns.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          finalizeAssistant(last.text || state.streamBuffer || "");
        }
        state.activeRunId = "";
        state.expectingRun = false;
        state.streamBuffer = "";
      }
    }

    function trimChatTurns() {
      if (state.chatTurns.length > MAX_CHAT_TURNS) {
        state.chatTurns = state.chatTurns.slice(-MAX_CHAT_TURNS);
      }
    }

    function renderChatTranscript() {
      const el = $("chatTranscript");
      if (!el) return;
      if (!state.chatTurns.length) {
        el.innerHTML = "<div class='chat-empty'>Send a message to start a run.</div>";
        return;
      }
      el.innerHTML = state.chatTurns.map(turn => {
        const role = turn.role === "user" ? "user" : "assistant";
        const streaming = turn.streaming ? " streaming" : "";
        return "<div class='chat-bubble " + role + streaming + "'>" +
          "<div class='chat-meta'>" + escapeHtml(role) + "</div>" +
          "<div class='chat-text'>" + escapeHtml(turn.text || "") + "</div>" +
        "</div>";
      }).join("");
      el.scrollTop = el.scrollHeight;
    }

    function appendChatDelta(text) {
      if (!text) return;
      const last = state.chatTurns[state.chatTurns.length - 1];
      if (last?.role === "assistant") {
        if (!last.streaming) return;
        last.text = (last.text || "") + text;
      } else {
        state.chatTurns.push({ role: "assistant", text, streaming: true });
      }
      trimChatTurns();
      renderChatTranscript();
    }

    function finalizeAssistant(text) {
      const last = state.chatTurns[state.chatTurns.length - 1];
      if (last && last.role === "assistant") {
        last.streaming = false;
        if (text) last.text = text;
      } else if (text) {
        state.chatTurns.push({ role: "assistant", text, streaming: false });
      }
      renderChatTranscript();
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
        const typeClass = event.type ? " event-" + event.type : "";
        return "<div class='event" + typeClass + "'>" +
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

    refreshAuthBanner();
    refreshAllProtected();
    connectEvents();
    setInterval(refreshHealth, 5000);
    setInterval(refreshRuns, 8000);
    setInterval(refreshProviders, 15000);
    setInterval(refreshPlugins, 15000);
    setInterval(refreshTools, 15000);
    setInterval(refreshMemoryCandidates, 15000);
    setInterval(refreshCronJobs, 15000);
  