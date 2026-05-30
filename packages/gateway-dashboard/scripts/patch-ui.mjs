import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "index.html");
let html = readFileSync(indexPath, "utf8");

const topbarOld = [
  "      <div class=\"topbar\">",
  "        <motion class=\"topbar-title\">",
].join("\n");

// fix typo in file - use div
const topbarOldFixed = `      <div class="topbar">
        <div class="topbar-title">
          <div class="status"><span id="healthDot" class="dot"></span><span id="healthText">checking</span></div>
          <span class="subtle" id="eventStatus">connecting</span>
        </div>
        <div class="secret-wrap">
          <label for="secret">Shared Secret</label>
          <input id="secret" type="password" autocomplete="off" placeholder="optional">
        </div>
      </div>`;

const topbarNew = `      <motion id="authBanner" class="auth-banner hidden" role="status"></motion>
      <div class="topbar">
        <div class="topbar-title">
          <button id="menuBtn" class="secondary menu-btn" type="button" aria-label="Menu">☰</button>
          <div class="status pill"><span id="healthDot" class="dot"></span><span id="healthText">checking</span></div>
          <span class="subtle pill" id="eventStatus">connecting</span>
        </div>
        <div class="topbar-actions">
          <button id="themeBtn" class="secondary" type="button" title="Toggle theme">Theme</button>
          <div class="secret-wrap">
            <label for="secret">Shared Secret</label>
            <input id="secret" type="password" autocomplete="off" placeholder="optional">
          </motion>
        </motion>
      </motion>`;

// Replace motion typos in topbarNew with div - write correctly:
const topbarNewFixed = `      <div id="authBanner" class="auth-banner hidden" role="status"></div>
      <div class="topbar">
        <div class="topbar-title">
          <button id="menuBtn" class="secondary menu-btn" type="button" aria-label="Menu">☰</button>
          <div class="status pill"><span id="healthDot" class="dot"></span><span id="healthText">checking</span></div>
          <span class="subtle pill" id="eventStatus">connecting</span>
        </div>
        <div class="topbar-actions">
          <button id="themeBtn" class="secondary" type="button" title="Toggle theme">Theme</button>
          <div class="secret-wrap">
            <label for="secret">Shared Secret</label>
            <input id="secret" type="password" autocomplete="off" placeholder="optional">
          </div>
        </div>
      </div>`;

if (html.includes(topbarOldFixed)) {
  html = html.replace(topbarOldFixed, topbarNewFixed);
}

html = html.replace(
  `<div class="message-field">
                  <label for="message">Message</label>
                  <textarea id="message"></textarea>
                </div>
                <pre id="runOutput" class="result-box"></pre>`,
  `<div class="chat-panel card">
                  <div class="chat-head">
                    <h3>Conversation</h3>
                    <button id="toggleRawBtn" class="secondary" type="button">Raw JSON</button>
                  </div>
                  <div id="chatTranscript" class="chat-transcript" aria-live="polite"></div>
                </div>
                <div class="message-field">
                  <label for="message">Message</label>
                  <textarea id="message" rows="4" placeholder="(drag .docx/.pdf/.xlsx/.png… here or paste an image)"></textarea>
                </div>
                <pre id="runOutput" class="result-box collapsed"></pre>`,
);

writeFileSync(indexPath, html, "utf8");

const legacyPath = join(root, "src", "legacy-app.js");
let js = readFileSync(legacyPath, "utf8");

if (!js.includes("activeRunId")) {
  js = js.replace(
    `secret: "",`,
    `secret: "",
      activeRunId: "",
      streamBuffer: "",
      chatTurns: [],`,
  );
}

if (!js.includes("function renderChatTranscript")) {
  const chatFns = `
    function renderChatTranscript() {
      const el = $("chatTranscript");
      if (!el) return;
      if (!state.chatTurns.length) {
        el.innerHTML = "<div class='chat-empty'>Send a message to start a run.</div>";
        return;
      }
      el.innerHTML = state.chatTurns.map(turn => {
        const role = turn.role === "user" ? "user" : "assistant";
        const label = role === "assistant" ? "🤖" : "我";
        const streaming = turn.streaming ? " streaming" : "";
        return "<div class='chat-bubble " + role + streaming + "'>" +
          "<div class='chat-line'><span class='chat-meta'>" + escapeHtml(label) + "：</span>" +
          "<span class='chat-text'>" + escapeHtml(turn.text || "") + "</span></div>" +
        "</div>";
      }).join("");
      el.scrollTop = el.scrollHeight;
    }

    function appendChatDelta(text) {
      if (!text) return;
      const last = state.chatTurns[state.chatTurns.length - 1];
      if (!last || last.role !== "assistant" || !last.streaming) {
        state.chatTurns.push({ role: "assistant", text: "", streaming: true });
      }
      const target = state.chatTurns[state.chatTurns.length - 1];
      target.text = (target.text || "") + text;
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

`;
  js = js.replace("    function pushLocalEvent(type, text) {", chatFns + "    function pushLocalEvent(type, text) {");
}

const sendRunOld = `async function sendRun() {
      const rawMessage = $("message").value.trim();
      if (!rawMessage) return;
      $("sendBtn").disabled = true;
      $("runOutput").style.display = "block";
      $("runOutput").textContent = "running...";
      try {
        const profile = selectedAgentProfile();
        const params = {
          sessionId: $("sessionId").value.trim() || "dashboard",
          message: profile?.systemPrompt ? profile.systemPrompt + "\n\n" + rawMessage : rawMessage,
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
    }`;

const sendRunNew = `async function sendRun() {
      const rawMessage = $("message").value.trim();
      if (!rawMessage) return;
      $("sendBtn").disabled = true;
      state.activeRunId = "";
      state.streamBuffer = "";
      state.chatTurns.push({ role: "user", text: rawMessage, streaming: false });
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
        renderChatTranscript();
        const payload = await rpc("agent", params);
        state.activeRunId = payload.result?.runId || "";
        const assistant = [...(payload.result?.messages || [])].reverse().find(message => message.role === "assistant");
        finalizeAssistant(assistant?.content || state.streamBuffer || "");
        $("runOutput").textContent = JSON.stringify(payload.result, null, 2);
        $("message").value = "";
        await refreshRuns();
      } catch (error) {
        finalizeAssistant("Error: " + (error.message || String(error)));
        $("runOutput").textContent = error.message || String(error);
        pushLocalEvent("error", error.message || String(error));
      } finally {
        $("sendBtn").disabled = false;
        state.streamBuffer = "";
      }
    }`;

if (js.includes(sendRunOld)) {
  js = js.replace(sendRunOld, sendRunNew);
}

js = js.replace(
  `        if (name === "loong.event") {
          state.events.unshift(parsed);
          state.events = state.events.slice(0, 80);
          renderEvents();
          if (parsed.event?.type === "lifecycle" && ["end", "error", "cancelled"].includes(parsed.event.phase)) {
            refreshRuns();
            refreshTrajectories();
            refreshMemoryCandidates();
          }
        }`,
  `        if (name === "loong.event") {
          state.events.unshift(parsed);
          state.events = state.events.slice(0, 80);
          const ev = parsed.event || {};
          if (ev.type === "assistant_delta" && ev.text) {
            state.streamBuffer += ev.text;
            if (!state.activeRunId || ev.runId === state.activeRunId) {
              appendChatDelta(ev.text);
            }
          }
          renderEvents();
          if (parsed.event?.type === "lifecycle" && ["end", "error", "cancelled"].includes(parsed.event.phase)) {
            refreshRuns();
            refreshTrajectories();
            refreshMemoryCandidates();
          }
        }`,
);

js = js.replace(
  `        return "<div class='event'>" +`,
  `        const typeClass = event.type ? " event-" + event.type : "";
        return "<div class='event" + typeClass + "'>" +`,
);

if (!js.includes("toggleRawBtn")) {
  js = js.replace(
    `$("reconnectBtn").addEventListener("click", connectEvents);`,
    `$("reconnectBtn").addEventListener("click", connectEvents);
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
    }`,
  );
}

writeFileSync(legacyPath, js, "utf8");
console.log("patched");
