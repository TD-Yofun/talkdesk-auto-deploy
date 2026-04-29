// ==UserScript==
// @name         Auto-Approve Deploy Gates
// @namespace    https://github.com/auto-deploy-gates
// @version      1.0.0
// @author       auto-deploy
// @description  Automatically approve GitHub Actions deployment gates & skip wait timers
// @match        https://github.com/*/actions/runs/*
// @connect      api.github.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function parseUrl() {
    const urlMatch = location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/
    );
    if (!urlMatch) return null;
    const [, owner, repo, runId] = urlMatch;
    return { owner, repo, runId };
  }
  function loadConfig() {
    return {
      token: GM_getValue("gh_token", ""),
      interval: GM_getValue("interval", 15),
      autoApprove: GM_getValue("auto_approve", true),
      autoSkip: GM_getValue("auto_skip", true),
      saveLog: GM_getValue("save_log", false),
      panelVisible: GM_getValue("panel_visible", true)
    };
  }
  function saveConfigField(key, value) {
    const keyMap = {
      token: "gh_token",
      interval: "interval",
      autoApprove: "auto_approve",
      autoSkip: "auto_skip",
      saveLog: "save_log",
      panelVisible: "panel_visible"
    };
    GM_setValue(keyMap[key], value);
  }
  const GRACE_PERIOD = 90;
  function createState() {
    return {
      running: false,
      pollTimer: null,
      sessionApproved: 0,
      totalApproved: 0,
      lastSkipKey: "",
      monitorStartedAt: 0,
      pollCycle: 0,
      sessionSkipped: 0,
      sessionEvents: []
    };
  }
  let _logBuffer = [];
  let _logFlushTimer = null;
  let _saveLog = false;
  let _logStoreKey = "";
  function initLogStore(runId, saveLog) {
    _logStoreKey = `aad_log_${runId}`;
    _saveLog = saveLog;
  }
  function setLogSaving(enabled) {
    _saveLog = enabled;
  }
  function _flushLogBuffer() {
    if (_logBuffer.length === 0) return;
    const arr = GM_getValue(_logStoreKey, []);
    const existing = typeof arr === "string" ? arr ? arr.split("\n").filter(Boolean) : [] : arr;
    existing.push(..._logBuffer);
    if (existing.length > 2e3) existing.splice(0, existing.length - 2e3);
    GM_setValue(_logStoreKey, existing);
    _logBuffer = [];
  }
  function appendLogToStore(line) {
    if (!_saveLog) return;
    _logBuffer.push(line);
    if (_logBuffer.length >= 20) {
      _flushLogBuffer();
    } else {
      if (_logFlushTimer) clearTimeout(_logFlushTimer);
      _logFlushTimer = setTimeout(_flushLogBuffer, 500);
    }
  }
  function getStoredLogs() {
    _flushLogBuffer();
    const data = GM_getValue(_logStoreKey, []);
    if (typeof data === "string") {
      return data ? data.split("\n").filter(Boolean) : [];
    }
    return data;
  }
  function downloadLog(runId) {
    const lines = getStoredLogs();
    if (lines.length === 0) {
      alert("当前 Run 暂无日志记录");
      return;
    }
    const content = lines.join("\n") + "\n";
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aad-run-${runId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function saveRunningState(runId, on) {
    const stateKey = `aad_running_${runId}`;
    GM_setValue(stateKey, on ? Date.now() : 0);
  }
  function wasRunning(runId) {
    const stateKey = `aad_running_${runId}`;
    const savedTs = GM_getValue(stateKey, 0);
    return savedTs > 0 && Date.now() - savedTs < 30 * 60 * 1e3;
  }
  function saveSession(runId, state) {
    const sessionKey = `aad_session_${runId}`;
    GM_setValue(sessionKey, {
      approved: state.sessionApproved,
      skipped: state.sessionSkipped,
      events: state.sessionEvents,
      startedAt: state.monitorStartedAt,
      pollCycle: state.pollCycle,
      lastSkipKey: state.lastSkipKey
    });
  }
  function loadSession(runId, state) {
    const sessionKey = `aad_session_${runId}`;
    const s = GM_getValue(sessionKey, null);
    if (!s) return false;
    state.sessionApproved = s.approved || 0;
    state.sessionSkipped = s.skipped || 0;
    state.sessionEvents = s.events || [];
    state.monitorStartedAt = s.startedAt || Date.now();
    state.pollCycle = s.pollCycle || 0;
    state.lastSkipKey = s.lastSkipKey || "";
    return true;
  }
  function clearSession(runId) {
    const sessionKey = `aad_session_${runId}`;
    GM_setValue(sessionKey, null);
  }
  const API = "https://api.github.com";
  function api(method, path, token, body) {
    return new Promise((resolve, reject) => {
      if (!token) return reject(new Error("No GitHub token configured"));
      GM_xmlhttpRequest({
        method,
        url: `${API}${path}`,
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        data: body ? JSON.stringify(body) : void 0,
        onload(r) {
          if (r.status >= 200 && r.status < 300) {
            try {
              resolve(JSON.parse(r.responseText));
            } catch {
              resolve(r.responseText);
            }
          } else {
            reject(new Error(`HTTP ${r.status}`));
          }
        },
        onerror() {
          reject(new Error("Network error"));
        }
      });
    });
  }
  function fetchRunInfo(owner, repo, runId, token) {
    return api("GET", `/repos/${owner}/${repo}/actions/runs/${runId}`, token);
  }
  function fetchPending(owner, repo, runId, token) {
    return api("GET", `/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`, token);
  }
  function approveDeployments(owner, repo, runId, token, envIds) {
    return api("POST", `/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`, token, {
      environment_ids: envIds,
      state: "approved",
      comment: "Auto-approved by Auto-Approve Deploy Gates"
    });
  }
  function skipWaitTimersViaApi(owner, repo, runId, token, envIds) {
    return api("POST", `/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`, token, {
      environment_ids: envIds,
      state: "approved",
      comment: "Wait timer skipped by Auto-Approve Deploy Gates"
    });
  }
  function fetchJobs(owner, repo, runId, token) {
    return api("GET", `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`, token);
  }
  function observeSkipButton(onDetected) {
    const check = (el) => /start all waiting/i.test(el.textContent || "");
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (check(node)) {
            onDetected();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const existing = document.querySelectorAll('button, [role="button"], summary');
    for (const btn of existing) {
      if (check(btn)) {
        onDetected();
        break;
      }
    }
    return () => observer.disconnect();
  }
  async function trySkipWaitTimers(owner, repo, addLog2, skipInitialDelay = false) {
    try {
      await new Promise((r) => setTimeout(r, skipInitialDelay ? 300 : 2e3));
      const allForms = [...document.querySelectorAll("form")];
      const skipForms = allForms.filter((f) => {
        const a = f.getAttribute("action") || "";
        return a.includes("environment") || a.includes("skip");
      });
      addLog2(`[skip-debug] Forms total: ${allForms.length}, skip-related: ${skipForms.length}`);
      skipForms.forEach(
        (f) => addLog2(`[skip-debug]   form action="${f.getAttribute("action")}"`)
      );
      const allBtns = [...document.querySelectorAll('button, [role="button"], summary, a.btn')];
      const relevantBtns = allBtns.filter(
        (b) => /start|skip|waiting|timer|deploy|approve|consequence/i.test(b.textContent || "")
      );
      addLog2(`[skip-debug] Relevant buttons: ${relevantBtns.length}`);
      relevantBtns.forEach(
        (b) => addLog2(`[skip-debug]   <${b.tagName.toLowerCase()}> "${(b.textContent || "").trim().slice(0, 80)}"`)
      );
      const gateInputs = document.querySelectorAll('input[name="gate_request[]"]');
      addLog2(`[skip-debug] gate_request[] inputs: ${gateInputs.length}`);
      gateInputs.forEach((i) => addLog2(`[skip-debug]   value="${i.value}"`));
      for (const btn of allBtns) {
        const text = (btn.textContent || "").trim();
        if (/start all waiting/i.test(text)) {
          addLog2(`[skip] Approach 1: clicking "${text}"`);
          btn.click();
          let dialog = null;
          for (let i = 0; i < 10; i++) {
            dialog = document.querySelector("#gates-break-glass-dialog[open], dialog[open].js-gates-dialog");
            if (dialog) break;
            await new Promise((r) => setTimeout(r, 500));
          }
          if (!dialog) {
            addLog2("[skip] Approach 1: dialog did not appear after clicking button", "warn");
            break;
          }
          addLog2(`[skip]   dialog found: #${dialog.id}`);
          const checkboxes = dialog.querySelectorAll(
            'input[type="checkbox"][name="gate_request[]"], input.js-gates-dialog-environment-checkbox'
          );
          addLog2(`[skip]   checkboxes found: ${checkboxes.length}`);
          checkboxes.forEach((cb) => {
            if (!cb.checked) {
              cb.click();
              addLog2(`[skip]   checked: ${cb.value} (${cb.id})`);
            } else {
              addLog2(`[skip]   already checked: ${cb.value}`);
            }
          });
          if (checkboxes.length === 0) {
            addLog2("[skip] Approach 1: no checkboxes found in dialog", "warn");
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
          const submitBtn = dialog.querySelector(
            'button[type="submit"], button.btn-danger, button[data-target="break-glass-deployments"]'
          );
          if (submitBtn) {
            const st = (submitBtn.textContent || "").trim();
            addLog2(`[skip]   clicking submit: "${st.slice(0, 60)}"`, "ok");
            submitBtn.click();
            await new Promise((r) => setTimeout(r, 3e3));
            return true;
          }
          addLog2("[skip] Approach 1: no submit button found in dialog", "warn");
          break;
        }
      }
      for (const form of skipForms) {
        const action = form.getAttribute("action") || "";
        if (action.endsWith("/skip")) {
          addLog2(`[skip] Approach 2: submitting form → ${action}`);
          const formData = new FormData(form);
          let addedGates = 0;
          if (!formData.has("gate_request[]")) {
            gateInputs.forEach((i) => {
              formData.append("gate_request[]", i.value);
              addedGates++;
            });
          }
          addLog2(`[skip]   form fields: ${[...formData.keys()].join(", ")} (added ${addedGates} gate_request from DOM)`);
          if (!formData.has("gate_request[]")) {
            addLog2(`[skip] Approach 2: no gate_request[] — skipping`, "warn");
            continue;
          }
          const resp = await fetch(action, {
            method: "POST",
            body: new URLSearchParams(formData),
            credentials: "same-origin",
            redirect: "follow"
          });
          addLog2(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
          if (resp.ok || resp.redirected) {
            addLog2(`[skip] Approach 2: form submitted OK`, "ok");
            return true;
          }
          addLog2(`[skip] Approach 2: form submit failed (${resp.status})`, "warn");
        }
      }
      const csrfInput = skipForms.length > 0 ? skipForms[0].querySelector('input[name="authenticity_token"]') : null;
      if (csrfInput && gateInputs.length > 0) {
        const csrf = csrfInput.value;
        addLog2(`[skip] Approach 3: manual POST with CSRF from form + ${gateInputs.length} gate(s)`);
        const body = new URLSearchParams();
        body.append("authenticity_token", csrf);
        body.append("comment", "Auto-skipped by Auto-Approve Deploy Gates");
        gateInputs.forEach((i) => body.append("gate_request[]", i.value));
        const skipUrl = `/${owner}/${repo}/environments/skip`;
        addLog2(`[skip]   POST → ${skipUrl}`);
        const resp = await fetch(skipUrl, {
          method: "POST",
          body,
          credentials: "same-origin",
          redirect: "follow"
        });
        addLog2(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
        if (resp.ok || resp.redirected) {
          addLog2(`[skip] Approach 3: POST succeeded`, "ok");
          return true;
        }
        addLog2(`[skip] Approach 3: POST failed (${resp.status})`, "warn");
      }
      addLog2("[skip] All approaches exhausted — no skip controls found", "warn");
      return false;
    } catch (e) {
      addLog2(`[skip] Error: ${e.message}`, "warn");
      return false;
    }
  }
  const ts = () => ( new Date()).toLocaleTimeString("en-US", { hour12: false });
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function formatDuration(ms) {
    const secs = Math.floor(ms / 1e3);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remSecs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  }
  function injectStyles() {
    GM_addStyle(`
    /* ── Side Panel ───────────────────────────────────────── */
    #aad-panel {
      position: fixed !important;
      top: 0; right: 0;
      width: 360px;
      height: 100vh;
      background: #161b22;
      border-left: 1px solid #30363d;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 2147483647 !important;
      box-shadow: -4px 0 16px rgba(0,0,0,.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: transform .3s cubic-bezier(.4,0,.2,1);
    }
    #aad-panel.collapsed { transform: translateX(100%); }

    /* ── Collapse Tab ─────────────────────────────────────── */
    #aad-tab {
      position: fixed !important;
      top: 50%; right: 0;
      transform: translateY(-50%);
      z-index: 2147483647 !important;
      background: #0d1117;
      border: 1px solid #30363d;
      border-right: none;
      border-radius: 8px 0 0 8px;
      padding: 10px 5px;
      cursor: pointer;
      color: #8b949e;
      font-size: 11px;
      font-weight: 600;
      writing-mode: vertical-rl;
      letter-spacing: 1px;
      user-select: none;
      transition: right .3s cubic-bezier(.4,0,.2,1), background .15s;
    }
    #aad-tab:hover { background: #161b22; color: #e6edf3; }
    #aad-tab.shifted { right: 360px; }

    /* ── Header ───────────────────────────────────────────── */
    #aad-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      flex-shrink: 0;
      user-select: none;
    }
    #aad-header .aad-title {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #aad-header .aad-btns { display: flex; gap: 4px; }
    #aad-header .aad-btns button {
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    #aad-header .aad-btns button:hover { color: #e6edf3; background: #30363d; }

    /* ── Body ─────────────────────────────────────────────── */
    #aad-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex: 1;
      min-height: 0;
    }

    /* ── Info ─────────────────────────────────────────────── */
    #aad-info {
      padding: 10px 14px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
      color: #8b949e;
      line-height: 1.6;
      flex-shrink: 0;
    }
    #aad-info strong { color: #e6edf3; font-weight: 500; }
    #aad-info .aad-run-name { color: #58a6ff; }
    #aad-info .aad-status-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }
    .aad-badge-queued      { background: #d29922; color: #0d1117; }
    .aad-badge-in_progress { background: #58a6ff; color: #0d1117; }
    .aad-badge-waiting     { background: #d29922; color: #0d1117; }
    .aad-badge-completed   { background: #3fb950; color: #0d1117; }
    .aad-badge-failure     { background: #f85149; color: #0d1117; }

    /* ── Controls ─────────────────────────────────────────── */
    #aad-controls {
      padding: 10px 14px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #21262d;
      flex-shrink: 0;
    }
    #aad-toggle-btn {
      padding: 5px 16px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      transition: background .15s;
    }
    #aad-toggle-btn.start { background: #238636; }
    #aad-toggle-btn.start:hover { background: #2ea043; }
    #aad-toggle-btn.stop  { background: #da3633; }
    #aad-toggle-btn.stop:hover  { background: #f85149; }
    #aad-controls label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8b949e;
      cursor: pointer;
    }
    #aad-controls label:hover { color: #e6edf3; }
    #aad-controls input[type="checkbox"] { accent-color: #238636; }
    #aad-interval-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8b949e;
    }
    #aad-interval-input {
      width: 40px;
      padding: 2px 4px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 4px;
      color: #e6edf3;
      font-size: 12px;
      text-align: center;
    }
    #aad-token-btn, #aad-dl-log-btn {
      background: none;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 8px;
    }
    #aad-token-btn:hover, #aad-dl-log-btn:hover { color: #e6edf3; border-color: #8b949e; }
    #aad-controls .aad-disabled { opacity: 0.4; pointer-events: none; }

    /* ── Status Bar ───────────────────────────────────────── */
    #aad-status-bar {
      padding: 8px 14px;
      font-size: 12px;
      color: #8b949e;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #aad-status-bar .aad-counters strong { color: #3fb950; }

    /* ── Log Path ─────────────────────────────────────────── */
    #aad-log-path {
      padding: 4px 14px;
      font-size: 11px;
      color: #58a6ff;
      border-bottom: 1px solid #21262d;
      display: none;
      flex-shrink: 0;
    }

    /* ── Summary Report ───────────────────────────────────── */
    #aad-summary {
      padding: 12px 14px;
      border-bottom: 1px solid #21262d;
      display: none;
      flex-shrink: 0;
      max-height: 40vh;
      overflow-y: auto;
    }
    .aad-summary-header {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      color: #e6edf3;
    }
    .aad-summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 16px;
    }
    .aad-summary-item {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .aad-summary-label { color: #8b949e; }
    .aad-timeline {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      line-height: 1.6;
    }
    .aad-timeline-item { color: #8b949e; }

    /* ── Log ──────────────────────────────────────────────── */
    #aad-log {
      flex: 1;
      overflow-y: auto;
      padding: 8px 14px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      min-height: 0;
    }
    #aad-log::-webkit-scrollbar { width: 6px; }
    #aad-log::-webkit-scrollbar-track { background: transparent; }
    #aad-log::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .aad-log-entry { white-space: pre-wrap; word-break: break-word; }
    .aad-log-time  { color: #484f58; }
    .aad-log-info  { color: #8b949e; }
    .aad-log-ok    { color: #3fb950; }
    .aad-log-warn  { color: #d29922; }
    .aad-log-err   { color: #f85149; }
  `);
  }
  function buildUI(runId, config) {
    const panel = document.createElement("div");
    panel.id = "aad-panel";
    panel.innerHTML = `
    <div id="aad-header">
      <span class="aad-title">🚀 Auto-Approve Deploy</span>
      <span class="aad-btns">
        <button id="aad-collapse-btn" title="Collapse panel">▶</button>
      </span>
    </div>
    <div id="aad-body">
      <div id="aad-info">Loading run info...</div>
      <div id="aad-controls">
        <button id="aad-toggle-btn" class="start">▶ Start</button>
        <div id="aad-interval-wrap">
          ⏱ <input id="aad-interval-input" type="number" min="5" max="300" value="${config.interval}">s
        </div>
        <label><input type="checkbox" id="aad-chk-approve" ${config.autoApprove ? "checked" : ""}> Approve</label>
        <label><input type="checkbox" id="aad-chk-skip"    ${config.autoSkip ? "checked" : ""}> Skip timers</label>
        <label><input type="checkbox" id="aad-chk-savelog" ${config.saveLog ? "checked" : ""}> 💾 Log</label>
        <button id="aad-dl-log-btn" title="Download log file">📥</button>
        <button id="aad-token-btn">🔑 Token</button>
      </div>
      <div id="aad-status-bar">
        <span id="aad-status-text">Idle</span>
        <span class="aad-counters">Session: <strong id="aad-session-cnt">0</strong> · Total: <strong id="aad-total-cnt">0</strong></span>
      </div>
      <div id="aad-log-path">💾 日志将保存至浏览器下载目录: aad-run-${runId}.log</div>
      <div id="aad-summary"></div>
      <div id="aad-log"></div>
    </div>
  `;
    document.body.appendChild(panel);
    const tab = document.createElement("div");
    tab.id = "aad-tab";
    tab.className = "shifted";
    tab.textContent = "◀ AAD";
    tab.title = "Toggle Auto-Approve Deploy panel";
    document.body.appendChild(tab);
    const el = {
      panel,
      tab,
      $info: document.getElementById("aad-info"),
      $toggleBtn: document.getElementById("aad-toggle-btn"),
      $intervalIn: document.getElementById("aad-interval-input"),
      $chkApprove: document.getElementById("aad-chk-approve"),
      $chkSkip: document.getElementById("aad-chk-skip"),
      $chkSaveLog: document.getElementById("aad-chk-savelog"),
      $dlLogBtn: document.getElementById("aad-dl-log-btn"),
      $logPath: document.getElementById("aad-log-path"),
      $statusText: document.getElementById("aad-status-text"),
      $sessionCnt: document.getElementById("aad-session-cnt"),
      $totalCnt: document.getElementById("aad-total-cnt"),
      $log: document.getElementById("aad-log"),
      $summary: document.getElementById("aad-summary"),
      $tokenBtn: document.getElementById("aad-token-btn")
    };
    if (config.saveLog) el.$logPath.style.display = "block";
    if (!config.panelVisible) {
      panel.classList.add("collapsed");
      tab.classList.remove("shifted");
      tab.textContent = "◀ AAD";
    }
    function togglePanel() {
      const isCollapsed = panel.classList.toggle("collapsed");
      tab.classList.toggle("shifted", !isCollapsed);
      tab.textContent = isCollapsed ? "◀ AAD" : "▶";
      config.panelVisible = !isCollapsed;
      saveConfigField("panelVisible", config.panelVisible);
    }
    tab.addEventListener("click", togglePanel);
    document.getElementById("aad-collapse-btn").addEventListener("click", togglePanel);
    return el;
  }
  function renderRunInfo(el, run, owner, repo) {
    const badgeClass = run.status === "completed" ? run.conclusion === "success" ? "aad-badge-completed" : "aad-badge-failure" : run.status === "in_progress" ? "aad-badge-in_progress" : "aad-badge-queued";
    el.$info.innerHTML = `
    <strong>${esc(owner)}/${esc(repo)}</strong><br>
    <span class="aad-run-name">${esc(run.name)}</span> · ${esc(run.head_branch)}<br>
    Status: <span class="aad-status-badge ${badgeClass}">${esc(run.status)}${run.conclusion ? " · " + esc(run.conclusion) : ""}</span>
  `;
  }
  function renderToggle(el, running) {
    if (running) {
      el.$toggleBtn.textContent = "⏹ Stop";
      el.$toggleBtn.className = "stop";
      setControlsEnabled(el, false);
    } else {
      el.$toggleBtn.textContent = "▶ Start";
      el.$toggleBtn.className = "start";
      setControlsEnabled(el, true);
    }
  }
  function renderCounters(el, state) {
    el.$sessionCnt.textContent = String(state.sessionApproved);
    el.$totalCnt.textContent = String(state.totalApproved);
  }
  function setStatus(el, html) {
    el.$statusText.innerHTML = html;
  }
  function addLog(el, msg, level = "info") {
    const tag = "[AAD]";
    const consoleFn = level === "err" ? console.error : level === "warn" ? console.warn : level === "ok" ? console.info : console.log;
    consoleFn(`${tag} ${msg}`);
    const timeStr = ts();
    appendLogToStore(`[${timeStr}] [${level}] ${msg}`);
    const entry = document.createElement("div");
    entry.className = "aad-log-entry";
    entry.innerHTML = `<span class="aad-log-time">${timeStr}</span> <span class="aad-log-${level}">${esc(msg)}</span>`;
    el.$log.appendChild(entry);
    el.$log.scrollTop = el.$log.scrollHeight;
    while (el.$log.children.length > 200) {
      el.$log.removeChild(el.$log.firstChild);
    }
  }
  function restoreLogsToPanel(el) {
    const lines = getStoredLogs();
    if (lines.length === 0) return;
    const recent = lines.slice(-50);
    const sep = document.createElement("div");
    sep.className = "aad-log-entry";
    sep.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 以下为刷新前日志 (最近 ${recent.length}/${lines.length} 条) ──</span>`;
    el.$log.appendChild(sep);
    recent.forEach((line) => {
      const m = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
      const entry = document.createElement("div");
      entry.className = "aad-log-entry";
      if (m) {
        entry.innerHTML = `<span class="aad-log-time">${esc(m[1])}</span> <span class="aad-log-${m[2]}">${esc(m[3])}</span>`;
      } else {
        entry.innerHTML = `<span class="aad-log-info">${esc(line)}</span>`;
      }
      el.$log.appendChild(entry);
    });
    const sep2 = document.createElement("div");
    sep2.className = "aad-log-entry";
    sep2.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 当前会话开始 ──</span>`;
    el.$log.appendChild(sep2);
    el.$log.scrollTop = el.$log.scrollHeight;
  }
  function generateSummary(el, state, config, conclusion) {
    const duration = Date.now() - state.monitorStartedAt;
    const timelineHtml = state.sessionEvents.map((ev) => {
      const t = new Date(ev.ts).toLocaleTimeString("en-US", { hour12: false });
      const icon = ev.type === "approve" ? "✅" : ev.type === "skip" ? "⏭" : ev.type === "error" ? "❌" : ev.type === "start" ? "🚀" : ev.type === "resume" ? "🔄" : ev.type === "complete" ? "🏁" : "📌";
      return `<div class="aad-timeline-item"><span class="aad-log-time">${t}</span> ${icon} ${esc(ev.detail)}</div>`;
    }).join("");
    const ok = conclusion === "success";
    const statusIcon = ok ? "✅" : "❌";
    const statusClass = ok ? "aad-log-ok" : "aad-log-err";
    el.$summary.innerHTML = `
    <div class="aad-summary-header">📊 执行报告</div>
    <div class="aad-summary-grid">
      <div class="aad-summary-item">
        <span class="aad-summary-label">结果</span>
        <span class="${statusClass}">${statusIcon} ${esc(conclusion)}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">总耗时</span>
        <span>${formatDuration(duration)}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">轮询次数</span>
        <span>${state.pollCycle}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">审批通过</span>
        <span class="aad-log-ok">${state.sessionApproved}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">跳过计时器</span>
        <span>${state.sessionSkipped}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">轮询间隔</span>
        <span>${config.interval}s</span>
      </div>
    </div>
    ${state.sessionEvents.length > 0 ? `
      <div class="aad-summary-header" style="margin-top:8px">📋 执行时间线</div>
      <div class="aad-timeline">${timelineHtml}</div>
    ` : ""}
  `;
    el.$summary.style.display = "block";
  }
  function setControlsEnabled(el, enabled) {
    const checkboxes = [el.$chkApprove, el.$chkSkip, el.$chkSaveLog];
    checkboxes.forEach((cb) => {
      cb.disabled = !enabled;
      const label = cb.closest("label");
      if (label) label.classList.toggle("aad-disabled", !enabled);
    });
    el.$intervalIn.disabled = !enabled;
    const wrap = el.$intervalIn.closest("#aad-interval-wrap");
    if (wrap) wrap.classList.toggle("aad-disabled", !enabled);
    [el.$tokenBtn, el.$dlLogBtn].forEach((btn) => {
      btn.disabled = !enabled;
      btn.classList.toggle("aad-disabled", !enabled);
    });
  }
  const params = parseUrl();
  if (params) {
    let recordEvent = function(type, detail) {
      state.sessionEvents.push({ ts: Date.now(), type, detail });
      saveSession(runId, state);
    }, startSkipObserver = function() {
      stopSkipObserver();
      disconnectSkipObserver = observeSkipButton(handleSkipDetected);
    }, stopSkipObserver = function() {
      if (disconnectSkipObserver) {
        disconnectSkipObserver();
        disconnectSkipObserver = null;
      }
    }, checkUrlMatch = function() {
      const current = parseUrl();
      if (!current || current.runId !== runId) {
        const page = current ? `${current.owner}/${current.repo}/runs/${current.runId}` : location.pathname;
        log(`⚠️ Page navigated away from run #${runId} → ${page}`, "warn");
        log("⏹ Auto-stopped: monitoring only works on the original action page.", "err");
        setStatus(el, `⚠️ Stopped: page no longer matches run #${runId}`);
        stop();
        return false;
      }
      return true;
    }, softRefresh = function() {
      log("Refreshing page...");
      location.reload();
    }, start = function() {
      if (!config.token) {
        promptToken();
        return;
      }
      state.running = true;
      state.sessionApproved = 0;
      state.sessionSkipped = 0;
      state.sessionEvents = [];
      state.lastSkipKey = "";
      state.pollCycle = 0;
      state.monitorStartedAt = Date.now();
      clearSession(runId);
      saveRunningState(runId, true);
      el.$summary.style.display = "none";
      recordEvent("start", `Started (interval=${config.interval}s, approve=${config.autoApprove}, skip=${config.autoSkip})`);
      log(`🚀 Started monitoring (interval=${config.interval}s, approve=${config.autoApprove}, skip=${config.autoSkip}, log=${config.saveLog})`);
      renderToggle(el, true);
      startSkipObserver();
      poll();
    }, resume = function() {
      if (!config.token) {
        promptToken();
        return;
      }
      state.running = true;
      loadSession(runId, state);
      saveRunningState(runId, true);
      el.$summary.style.display = "none";
      recordEvent("resume", `Resumed after page refresh`);
      log(`🚀 Started monitoring (interval=${config.interval}s, approve=${config.autoApprove}, skip=${config.autoSkip}, log=${config.saveLog})`);
      renderToggle(el, true);
      renderCounters(el, state);
      startSkipObserver();
      poll();
    }, stop = function() {
      state.running = false;
      saveRunningState(runId, false);
      stopSkipObserver();
      if (state.pollTimer) {
        clearTimeout(state.pollTimer);
        state.pollTimer = null;
      }
      log(`⏹ Stopped (cycles=${state.pollCycle}, session=${state.sessionApproved})`);
      saveSession(runId, state);
      renderToggle(el, false);
    }, promptToken = function() {
      const t = prompt("Enter your GitHub token (run `gh auth token` in terminal):", config.token);
      if (t && t.trim()) {
        config.token = t.trim();
        saveConfigField("token", config.token);
        log("🔑 Token saved");
        start();
      }
    };
    const { owner, repo, runId } = params;
    const config = loadConfig();
    const state = createState();
    initLogStore(runId, config.saveLog);
    injectStyles();
    const el = buildUI(runId, config);
    const log = (msg, level) => addLog(el, msg, level);
    let skipInProgress = false;
    let skipCooldownUntil = 0;
    let disconnectSkipObserver = null;
    async function handleSkipDetected() {
      if (skipInProgress || !state.running || !config.autoSkip) return;
      if (Date.now() < skipCooldownUntil) return;
      skipInProgress = true;
      log('[skip-observer] Detected "Start all waiting jobs" button in DOM');
      try {
        const skipped = await trySkipWaitTimers(owner, repo, log, true);
        if (skipped) {
          log("✅ Skip attempted (observer) — refreshing...", "ok");
          state.sessionSkipped++;
          recordEvent("skip", "Skipped wait timers (observer/DOM)");
          saveSession(runId, state);
          softRefresh();
        } else {
          log("⚠️ DOM skip failed (observer). Trying API-based skip...", "warn");
          try {
            const pending = await fetchPending(owner, repo, runId, config.token);
            const waitGates = pending.filter(
              (d) => !d.current_user_can_approve && d.wait_timer && d.wait_timer > 0
            );
            if (waitGates.length > 0) {
              const envIds = waitGates.map((d) => d.environment.id);
              const envNames = waitGates.map((d) => d.environment.name).join(", ");
              await skipWaitTimersViaApi(owner, repo, runId, config.token, envIds);
              log(`✅ Skipped via API (observer): ${envNames}`, "ok");
              state.sessionSkipped++;
              recordEvent("skip", `Skipped wait timers (observer/API): ${envNames}`);
              saveSession(runId, state);
            }
          } catch (e) {
            log(`⚠️ API skip also failed (observer): ${e.message}`, "warn");
          }
          skipCooldownUntil = Date.now() + 3e4;
        }
      } finally {
        skipInProgress = false;
      }
    }
    async function poll() {
      if (!state.running) return;
      if (!checkUrlMatch()) return;
      state.pollCycle++;
      saveRunningState(runId, true);
      log(`[poll #${state.pollCycle}] polling...`);
      try {
        const run = await fetchRunInfo(owner, repo, runId, config.token);
        renderRunInfo(el, run, owner, repo);
        if (run.status === "completed") {
          const elapsed = (Date.now() - state.monitorStartedAt) / 1e3;
          if (state.sessionApproved === 0 && elapsed < GRACE_PERIOD) {
            const remaining = Math.ceil(GRACE_PERIOD - elapsed);
            log(`⏳ Run shows completed but grace period active (${remaining}s left) — re-run may not have propagated yet`, "warn");
            setStatus(el, `⏳ Waiting for re-run to start... (${remaining}s)`);
            if (state.running) {
              state.pollTimer = setTimeout(poll, config.interval * 1e3);
            }
            return;
          } else {
            const ok = run.conclusion === "success";
            recordEvent("complete", `Run ${ok ? "succeeded" : "failed"}: ${run.conclusion}`);
            log(
              ok ? `✅ Run completed! (session: ${state.sessionApproved}, total: ${state.totalApproved})` : `❌ Run finished: ${run.conclusion} (session: ${state.sessionApproved}, total: ${state.totalApproved})`,
              ok ? "ok" : "err"
            );
            generateSummary(el, state, config, run.conclusion || "unknown");
            stop();
            return;
          }
        }
        const pending = await fetchPending(owner, repo, runId, config.token);
        const approvable = pending.filter((d) => d.current_user_can_approve);
        log(`[poll] status=${run.status}, pending=${pending.length}, approvable=${approvable.length}`);
        if (config.autoApprove && approvable.length > 0) {
          const envIds = approvable.map((d) => d.environment.id);
          const envNames = approvable.map((d) => d.environment.name).join(", ");
          log(`Found ${approvable.length} approvable gate(s): ${envNames}`);
          try {
            await approveDeployments(owner, repo, runId, config.token, envIds);
            log(`✅ Approved: ${envNames}`, "ok");
            state.sessionApproved += approvable.length;
            state.totalApproved += approvable.length;
            recordEvent("approve", `Approved: ${envNames}`);
            renderCounters(el, state);
            if (state.running) {
              state.pollTimer = setTimeout(poll, 5e3);
            }
            return;
          } catch (e) {
            log(`⚠️ Approve failed: ${e.message}`, "warn");
          }
        } else if (pending.length > 0) {
          const waitGates = pending.filter(
            (d) => !d.current_user_can_approve && d.wait_timer && d.wait_timer > 0
          );
          if (config.autoSkip && waitGates.length > 0 && !skipInProgress) {
            const skipKey = waitGates.map((d) => d.environment.name).sort().join(",");
            if (skipKey !== state.lastSkipKey) {
              state.lastSkipKey = skipKey;
              log(`Detected wait timer(s): ${skipKey}`);
              log("Attempting to skip via page DOM...");
              const skipped = await trySkipWaitTimers(owner, repo, log);
              if (skipped) {
                log("✅ Skip attempted — checking result...", "ok");
                state.sessionSkipped++;
                recordEvent("skip", `Skipped wait timers (DOM): ${skipKey}`);
                saveSession(runId, state);
                softRefresh();
              } else {
                log("⚠️ DOM skip failed. Trying API-based skip...", "warn");
                const envIds = waitGates.map((d) => d.environment.id);
                try {
                  await skipWaitTimersViaApi(owner, repo, runId, config.token, envIds);
                  log(`✅ Skipped via API: ${skipKey}`, "ok");
                  state.sessionSkipped++;
                  recordEvent("skip", `Skipped wait timers (API): ${skipKey}`);
                  saveSession(runId, state);
                  if (state.running) {
                    state.pollTimer = setTimeout(poll, 5e3);
                  }
                  return;
                } catch (e) {
                  log(`⚠️ API skip also failed: ${e.message} — waiting for timer(s) to expire.`, "warn");
                }
              }
            }
          }
          const timerText = pending.filter((d) => !d.current_user_can_approve).map((d) => {
            if (d.wait_timer > 0 && d.wait_timer_started_at) {
              const totalSecs = d.wait_timer * 60;
              const started = new Date(d.wait_timer_started_at).getTime() / 1e3;
              const remaining = Math.ceil(started + totalSecs - Date.now() / 1e3);
              if (remaining > 0) {
                const m = Math.floor(remaining / 60);
                const s = remaining % 60;
                return `${esc(d.environment.name)} ⏱ ${m}m${s}s`;
              }
              return `${esc(d.environment.name)} ⏱ expired`;
            }
            return `${esc(d.environment.name)} (waiting)`;
          }).join(" · ");
          setStatus(el, `⏳ ${pending.length} pending — ${timerText}`);
        } else {
          setStatus(el, `🔄 Monitoring... (${run.status})`);
        }
      } catch (e) {
        log(`⚠️ Poll error: ${e.message}`, "warn");
      }
      if (state.running) {
        state.pollTimer = setTimeout(poll, config.interval * 1e3);
      }
    }
    el.$toggleBtn.addEventListener("click", () => {
      state.running ? stop() : start();
    });
    el.$intervalIn.addEventListener("change", () => {
      config.interval = Math.max(5, parseInt(el.$intervalIn.value, 10) || 30);
      el.$intervalIn.value = String(config.interval);
      saveConfigField("interval", config.interval);
    });
    el.$chkApprove.addEventListener("change", () => {
      config.autoApprove = el.$chkApprove.checked;
      saveConfigField("autoApprove", config.autoApprove);
    });
    el.$chkSkip.addEventListener("change", () => {
      config.autoSkip = el.$chkSkip.checked;
      saveConfigField("autoSkip", config.autoSkip);
    });
    el.$chkSaveLog.addEventListener("change", () => {
      config.saveLog = el.$chkSaveLog.checked;
      saveConfigField("saveLog", config.saveLog);
      setLogSaving(config.saveLog);
      el.$logPath.style.display = config.saveLog ? "block" : "none";
      if (config.saveLog) {
        log(`💾 日志记录已开启 — 文件: aad-run-${runId}.log`, "ok");
      } else {
        log("💾 日志记录已关闭", "info");
      }
    });
    el.$dlLogBtn.addEventListener("click", () => downloadLog(runId));
    el.$tokenBtn.addEventListener("click", promptToken);
    GM_registerMenuCommand("🔑 Set GitHub Token", promptToken);
    GM_registerMenuCommand("🚀 Start Monitoring", start);
    GM_registerMenuCommand("⏹ Stop Monitoring", stop);
    (async function init() {
      if (!config.token) {
        el.$info.innerHTML = `<span style="color:#d29922">⚠️ No token configured — click <b>🔑 Token</b> to set one.</span>`;
        log("No token configured. Click 🔑 Token to set your GitHub token.", "warn");
        return;
      }
      try {
        const run = await fetchRunInfo(owner, repo, runId, config.token);
        renderRunInfo(el, run, owner, repo);
        state.totalApproved = 0;
        try {
          const jobsData = await fetchJobs(owner, repo, runId, config.token);
          const gateJobs = jobsData.jobs.filter((j) => /gate/i.test(j.name));
          state.totalApproved = gateJobs.filter((j) => j.conclusion === "success").length;
          renderCounters(el, state);
        } catch {
        }
        log(`Ready — ${owner}/${repo} run #${runId}`);
        if (config.saveLog) {
          restoreLogsToPanel(el);
        }
        if (wasRunning(runId)) {
          log("🔄 Resuming after page refresh...", "ok");
          resume();
        }
      } catch (e) {
        el.$info.innerHTML = `<span style="color:#f85149">❌ Failed to load run info: ${esc(e.message)}</span>`;
        log(`Failed to load run info: ${e.message}`, "err");
      }
    })();
  }

})();