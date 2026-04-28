// ==UserScript==
// @name         Auto-Approve Deploy Gates
// @namespace    https://github.com/auto-deploy-gates
// @version      1.0.0
// @description  Automatically approve GitHub Actions deployment gates & skip wait timers
// @author       auto-deploy
// @match        https://github.com/*/actions/runs/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // URL Parsing
  // ═══════════════════════════════════════════════════════════════════════════
  const urlMatch = location.pathname.match(
    /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/
  );
  if (!urlMatch) return;
  const [, OWNER, REPO, RUN_ID] = urlMatch;
  const API = 'https://api.github.com';

  // ═══════════════════════════════════════════════════════════════════════════
  // Persistent Config
  // ═══════════════════════════════════════════════════════════════════════════
  let token      = GM_getValue('gh_token', '');
  let interval   = GM_getValue('interval', 30);
  let cfgApprove = GM_getValue('auto_approve', true);
  let cfgSkip    = GM_getValue('auto_skip', true);
  let cfgSaveLog = GM_getValue('save_log', false);

  // ═══════════════════════════════════════════════════════════════════════════
  // Runtime State
  // ═══════════════════════════════════════════════════════════════════════════
  let running         = false;
  let pollTimer       = null;
  let sessionApproved = 0;
  let totalApproved   = 0;
  let lastSkipKey     = '';
  let monitorStartedAt = 0;   // timestamp when monitoring began
  const GRACE_PERIOD   = 90;  // seconds to wait for re-run to propagate

  // Log persistence per run
  const logStoreKey = `aad_log_${RUN_ID}`;
  function appendLogToStore(line) {
    if (!cfgSaveLog) return;
    const existing = GM_getValue(logStoreKey, '');
    GM_setValue(logStoreKey, existing + line + '\n');
  }
  function downloadLog() {
    const content = GM_getValue(logStoreKey, '');
    if (!content) {
      alert('当前 Run 暂无日志记录');
      return;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aad-run-${RUN_ID}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Persist running state per run so script auto-resumes after page refresh
  const stateKey = `aad_running_${RUN_ID}`;
  function saveRunningState(on) {
    if (on) {
      GM_setValue(stateKey, Date.now());
    } else {
      GM_setValue(stateKey, 0);
    }
  }
  function wasRunning() {
    const ts = GM_getValue(stateKey, 0);
    // Consider stale if saved more than 30 minutes ago (page was probably closed)
    return ts > 0 && (Date.now() - ts) < 30 * 60 * 1000;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════
  const ts = () =>
    new Date().toLocaleTimeString('en-US', { hour12: false });

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GitHub REST API  (cross-origin via GM_xmlhttpRequest)
  // ═══════════════════════════════════════════════════════════════════════════
  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      if (!token) return reject(new Error('No GitHub token configured'));
      GM_xmlhttpRequest({
        method,
        url: `${API}${path}`,
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        data: body ? JSON.stringify(body) : undefined,
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
          reject(new Error('Network error'));
        },
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Core API Functions
  // ═══════════════════════════════════════════════════════════════════════════
  async function fetchRunInfo() {
    return api('GET', `/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}`);
  }

  async function fetchPending() {
    return api(
      'GET',
      `/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/pending_deployments`
    );
  }

  async function approveDeployments(envIds) {
    return api(
      'POST',
      `/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/pending_deployments`,
      {
        environment_ids: envIds,
        state: 'approved',
        comment: 'Auto-approved by Auto-Approve Deploy Gates (Tampermonkey)',
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Skip Wait Timers  (DOM-based — uses browser session cookies)
  //
  // Three approaches attempted in order:
  //   1. Find <form action="…/environments/skip"> and submit via fetch
  //   2. Find "Start all waiting jobs" button and click it
  //   3. Construct POST from CSRF meta + hidden gate_request[] inputs
  // ═══════════════════════════════════════════════════════════════════════════
  async function trySkipWaitTimers() {
    try {
      // Wait for dynamic rendering to settle
      await new Promise((r) => setTimeout(r, 2000));

      // ── DEBUG: dump relevant DOM elements ──────────────────────────────
      const allForms = [...document.querySelectorAll('form')];
      const skipForms = allForms.filter((f) => {
        const a = f.getAttribute('action') || '';
        return a.includes('environment') || a.includes('skip');
      });
      addLog(`[skip-debug] Forms total: ${allForms.length}, skip-related: ${skipForms.length}`);
      skipForms.forEach((f) =>
        addLog(`[skip-debug]   form action="${f.getAttribute('action')}"`)
      );

      const allBtns = [...document.querySelectorAll('button, [role="button"], summary, a.btn')];
      const relevantBtns = allBtns.filter((b) =>
        /start|skip|waiting|timer|deploy|approve|consequence/i.test(b.textContent || '')
      );
      addLog(`[skip-debug] Relevant buttons: ${relevantBtns.length}`);
      relevantBtns.forEach((b) =>
        addLog(`[skip-debug]   <${b.tagName.toLowerCase()}> "${(b.textContent || '').trim().slice(0, 80)}"`)
      );

      const gateInputs = document.querySelectorAll('input[name="gate_request[]"]');
      addLog(`[skip-debug] gate_request[] inputs: ${gateInputs.length}`);
      gateInputs.forEach((i) => addLog(`[skip-debug]   value="${i.value}"`));

      // ── Approach 1 (preferred): click "Start all waiting jobs" button ──
      for (const btn of allBtns) {
        const text = (btn.textContent || '').trim();
        if (/start all waiting/i.test(text)) {
          addLog(`[skip] Approach 1: clicking "${text}"`);
          btn.click();

          // Wait for #gates-break-glass-dialog to appear
          let dialog = null;
          for (let i = 0; i < 10; i++) {
            dialog = document.querySelector('#gates-break-glass-dialog[open], dialog[open].js-gates-dialog');
            if (dialog) break;
            await new Promise((r) => setTimeout(r, 500));
          }

          if (!dialog) {
            addLog('[skip] Approach 1: dialog did not appear after clicking button', 'warn');
            break;
          }
          addLog(`[skip]   dialog found: #${dialog.id}`);

          // Step 1: check all environment checkboxes
          const checkboxes = dialog.querySelectorAll(
            'input[type="checkbox"][name="gate_request[]"], input.js-gates-dialog-environment-checkbox'
          );
          addLog(`[skip]   checkboxes found: ${checkboxes.length}`);
          checkboxes.forEach((cb) => {
            if (!cb.checked) {
              cb.click();
              addLog(`[skip]   checked: ${cb.value} (${cb.id})`);
            } else {
              addLog(`[skip]   already checked: ${cb.value}`);
            }
          });

          if (checkboxes.length === 0) {
            addLog('[skip] Approach 1: no checkboxes found in dialog', 'warn');
            break;
          }

          // Small delay for any JS handlers to process checkbox change
          await new Promise((r) => setTimeout(r, 300));

          // Step 2: click the confirm/submit button
          const submitBtn = dialog.querySelector(
            'button[type="submit"], button.btn-danger, button[data-target="break-glass-deployments"]'
          );
          if (submitBtn) {
            const st = (submitBtn.textContent || '').trim();
            addLog(`[skip]   clicking submit: "${st.slice(0, 60)}"`, 'ok');
            submitBtn.click();

            // Wait for the page to navigate; if it doesn't, force reload
            await new Promise((r) => setTimeout(r, 3000));
            addLog(`[skip] Approach 1: confirmed! Reloading page...`, 'ok');
            location.reload();
            return true; // won't actually run if reload works
          }

          addLog('[skip] Approach 1: no submit button found in dialog', 'warn');
          break;
        }
      }

      // ── Approach 2: submit skip form WITH gate_request[] appended ─────
      for (const form of skipForms) {
        const action = form.getAttribute('action') || '';
        if (action.endsWith('/skip')) {
          addLog(`[skip] Approach 2: submitting form → ${action}`);
          const formData = new FormData(form);

          // Append gate_request[] from anywhere in the DOM (they may be outside the form)
          let addedGates = 0;
          if (!formData.has('gate_request[]')) {
            gateInputs.forEach((i) => {
              formData.append('gate_request[]', i.value);
              addedGates++;
            });
          }
          addLog(`[skip]   form fields: ${[...formData.keys()].join(', ')} (added ${addedGates} gate_request from DOM)`);

          if (!formData.has('gate_request[]')) {
            addLog(`[skip] Approach 2: no gate_request[] — skipping`, 'warn');
            continue;
          }

          const resp = await fetch(action, {
            method: 'POST',
            body: new URLSearchParams(formData),
            credentials: 'same-origin',
            redirect: 'follow',
          });
          addLog(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
          if (resp.ok || resp.redirected) {
            addLog(`[skip] Approach 2: form submitted OK`, 'ok');
            return true;
          }
          addLog(`[skip] Approach 2: form submit failed (${resp.status})`, 'warn');
        }
      }

      // ── Approach 3: manual POST from CSRF in form + gate_request[] ────
      // Since <meta name="csrf-token"> may not exist, extract from the skip form's hidden input
      const csrfInput = skipForms.length > 0
        ? skipForms[0].querySelector('input[name="authenticity_token"]')
        : null;
      if (csrfInput && gateInputs.length > 0) {
        const csrf = csrfInput.value;
        addLog(`[skip] Approach 3: manual POST with CSRF from form + ${gateInputs.length} gate(s)`);

        const body = new URLSearchParams();
        body.append('authenticity_token', csrf);
        body.append('comment', 'Auto-skipped by Auto-Approve Deploy Gates');
        gateInputs.forEach((i) => body.append('gate_request[]', i.value));

        const skipUrl = `/${OWNER}/${REPO}/environments/skip`;
        addLog(`[skip]   POST → ${skipUrl}`);
        const resp = await fetch(skipUrl, {
          method: 'POST',
          body,
          credentials: 'same-origin',
          redirect: 'follow',
        });
        addLog(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
        if (resp.ok || resp.redirected) {
          addLog(`[skip] Approach 3: POST succeeded`, 'ok');
          return true;
        }
        addLog(`[skip] Approach 3: POST failed (${resp.status})`, 'warn');
      }

      addLog('[skip] All approaches exhausted — no skip controls found', 'warn');
      return false;
    } catch (e) {
      addLog(`[skip] Error: ${e.message}`, 'warn');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Main Poll Loop
  // ═══════════════════════════════════════════════════════════════════════════
  async function poll() {
    if (!running) return;
    // Keep running-state timestamp fresh so it survives page reloads
    saveRunningState(true);
    try {
      // 1. Check run status
      const run = await fetchRunInfo();
      renderRunInfo(run);

      if (run.status === 'completed') {
        // Grace period: if we just started and haven't done anything yet,
        // the run may appear "completed" because a re-run hasn't propagated.
        const elapsed = (Date.now() - monitorStartedAt) / 1000;
        if (sessionApproved === 0 && elapsed < GRACE_PERIOD) {
          const remaining = Math.ceil(GRACE_PERIOD - elapsed);
          addLog(`⏳ Run shows completed but grace period active (${remaining}s left) — re-run may not have propagated yet`, 'warn');
          setStatus(`⏳ Waiting for re-run to start... (${remaining}s)`);
        } else {
          const ok = run.conclusion === 'success';
          addLog(
            ok
              ? `✅ Run completed! (session: ${sessionApproved}, total: ${totalApproved})`
              : `❌ Run finished: ${run.conclusion} (session: ${sessionApproved}, total: ${totalApproved})`,
            ok ? 'ok' : 'err'
          );
          stop();
          return;
        }
      }

      // 2. Fetch pending deployments
      const pending = await fetchPending();
      const approvable = pending.filter(
        (d) => d.current_user_can_approve
      );

      // 3. Auto-approve
      if (cfgApprove && approvable.length > 0) {
        const envIds = approvable.map((d) => d.environment.id);
        const envNames = approvable
          .map((d) => d.environment.name)
          .join(', ');
        addLog(`Found ${approvable.length} approvable gate(s): ${envNames}`);

        try {
          const result = await approveDeployments(envIds);
          if (Array.isArray(result)) {
            const names = result
              .map((r) => r.environment.name)
              .join(', ');
            addLog(`✅ Approved: ${names}`, 'ok');
            sessionApproved += approvable.length;
            totalApproved += approvable.length;
            renderCounters();
            softRefresh();
          } else {
            addLog('⚠️ Unexpected approve response', 'warn');
          }
        } catch (e) {
          addLog(`⚠️ Approve failed: ${e.message}`, 'warn');
        }
      } else if (pending.length > 0) {
        // 4. Skip wait timers (DOM-based)
        const waitGates = pending.filter(
          (d) =>
            !d.current_user_can_approve &&
            d.wait_timer &&
            d.wait_timer > 0
        );

        if (cfgSkip && waitGates.length > 0) {
          const skipKey = waitGates
            .map((d) => d.environment.name)
            .sort()
            .join(',');
          if (skipKey !== lastSkipKey) {
            lastSkipKey = skipKey;
            addLog(`Detected wait timer(s): ${skipKey}`);
            addLog('Attempting to skip via page DOM...');
            const skipped = await trySkipWaitTimers();
            if (skipped) {
              addLog('✅ Skip attempted — checking result...', 'ok');
              softRefresh();
            } else {
              addLog(
                '⚠️ Skip controls not found in DOM. Waiting for timer(s) to expire.',
                'warn'
              );
            }
          }
        }

        // Show timer countdown
        const timerText = pending
          .filter((d) => !d.current_user_can_approve)
          .map((d) => {
            if (
              d.wait_timer > 0 &&
              d.wait_timer_started_at
            ) {
              const totalSecs = d.wait_timer * 60;
              const started =
                new Date(d.wait_timer_started_at).getTime() / 1000;
              const remaining = Math.ceil(
                started + totalSecs - Date.now() / 1000
              );
              if (remaining > 0) {
                const m = Math.floor(remaining / 60);
                const s = remaining % 60;
                return `${esc(d.environment.name)} ⏱ ${m}m${s}s`;
              }
              return `${esc(d.environment.name)} ⏱ expired`;
            }
            return `${esc(d.environment.name)} (waiting)`;
          })
          .join(' · ');

        setStatus(`⏳ ${pending.length} pending — ${timerText}`);
      } else {
        setStatus(`🔄 Monitoring... (${run.status})`);
      }
    } catch (e) {
      addLog(`⚠️ Poll error: ${e.message}`, 'warn');
    }

    if (running) {
      pollTimer = setTimeout(poll, interval * 1000);
    }
  }

  function softRefresh() {
    // Force a full page reload to pick up updated DOM state
    addLog('Refreshing page...');
    location.reload();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Start / Stop
  // ═══════════════════════════════════════════════════════════════════════════
  function start() {
    if (!token) {
      promptToken();
      return;
    }
    running = true;
    sessionApproved = 0;
    lastSkipKey = '';
    monitorStartedAt = Date.now();
    saveRunningState(true);
    addLog('🚀 Started monitoring');
    renderToggle();
    poll();
  }

  function stop() {
    running = false;
    saveRunningState(false);
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    addLog('⏹ Stopped');
    renderToggle();
  }

  function promptToken() {
    const t = prompt(
      'Enter your GitHub token (run `gh auth token` in terminal):',
      token
    );
    if (t && t.trim()) {
      token = t.trim();
      GM_setValue('gh_token', token);
      addLog('🔑 Token saved');
      start();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Styles
  // ═══════════════════════════════════════════════════════════════════════════
  GM_addStyle(`
    #aad-panel {
      position: fixed !important;
      bottom: 16px;
      right: 16px;
      width: 400px;
      max-height: 520px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 2147483647 !important;
      box-shadow: 0 8px 24px rgba(0,0,0,.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width .2s, max-height .2s;
    }
    #aad-panel.minimized {
      max-height: 40px;
      width: 260px;
    }
    #aad-panel.minimized #aad-body { display: none; }

    #aad-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      cursor: move;
      user-select: none;
      border-radius: 12px 12px 0 0;
      flex-shrink: 0;
    }
    #aad-panel.minimized #aad-header {
      border-radius: 12px;
      border-bottom: none;
    }
    #aad-header .aad-title {
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #aad-header .aad-btns {
      display: flex;
      gap: 4px;
    }
    #aad-header .aad-btns button {
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    #aad-header .aad-btns button:hover { color: #e6edf3; background: #30363d; }

    #aad-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #aad-info {
      padding: 8px 12px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
      color: #8b949e;
      line-height: 1.6;
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
    .aad-badge-queued    { background: #d29922; color: #0d1117; }
    .aad-badge-in_progress { background: #58a6ff; color: #0d1117; }
    .aad-badge-waiting   { background: #d29922; color: #0d1117; }
    .aad-badge-completed { background: #3fb950; color: #0d1117; }
    .aad-badge-failure   { background: #f85149; color: #0d1117; }

    #aad-controls {
      padding: 8px 12px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #21262d;
    }
    #aad-toggle-btn {
      padding: 4px 14px;
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
    #aad-controls input[type="checkbox"] {
      accent-color: #238636;
    }
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

    #aad-status-bar {
      padding: 6px 12px;
      font-size: 12px;
      color: #8b949e;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #aad-status-bar .aad-counters strong { color: #3fb950; }

    #aad-log {
      flex: 1;
      overflow-y: auto;
      padding: 6px 12px;
      max-height: 200px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      font-size: 11px;
      line-height: 1.5;
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

    #aad-token-btn, #aad-dl-log-btn {
      background: none;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      cursor: pointer;
      font-size: 11px;
      padding: 2px 8px;
    }
    #aad-token-btn:hover, #aad-dl-log-btn:hover { color: #e6edf3; border-color: #8b949e; }

    #aad-controls .aad-disabled {
      opacity: 0.4;
      pointer-events: none;
    }
    #aad-log-path {
      padding: 2px 12px 6px;
      font-size: 11px;
      color: #58a6ff;
      border-bottom: 1px solid #21262d;
      display: none;
    }
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // Build UI
  // ═══════════════════════════════════════════════════════════════════════════
  const panel = document.createElement('div');
  panel.id = 'aad-panel';
  panel.innerHTML = `
    <div id="aad-header">
      <span class="aad-title">🚀 Auto-Approve Deploy</span>
      <span class="aad-btns">
        <button id="aad-min-btn" title="Minimize">−</button>
        <button id="aad-close-btn" title="Close">×</button>
      </span>
    </div>
    <div id="aad-body">
      <div id="aad-info">Loading run info...</div>
      <div id="aad-controls">
        <button id="aad-toggle-btn" class="start">▶ Start</button>
        <div id="aad-interval-wrap">
          ⏱ <input id="aad-interval-input" type="number" min="5" max="300" value="${interval}">s
        </div>
        <label><input type="checkbox" id="aad-chk-approve" ${cfgApprove ? 'checked' : ''}> Approve</label>
        <label><input type="checkbox" id="aad-chk-skip"    ${cfgSkip ? 'checked' : ''}> Skip timers</label>
        <label><input type="checkbox" id="aad-chk-savelog" ${cfgSaveLog ? 'checked' : ''}> 💾 Log</label>
        <button id="aad-dl-log-btn" title="Download log file">📥</button>
        <button id="aad-token-btn">🔑 Token</button>
      </div>
      <div id="aad-status-bar">
        <span id="aad-status-text">Idle</span>
        <span class="aad-counters">Session: <strong id="aad-session-cnt">0</strong> · Total: <strong id="aad-total-cnt">0</strong></span>
      </div>
      <div id="aad-log-path">💾 日志将保存至浏览器下载目录: aad-run-${RUN_ID}.log</div>
      <div id="aad-log"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // ── Element references ────────────────────────────────────────────────────
  const $info       = document.getElementById('aad-info');
  const $toggleBtn  = document.getElementById('aad-toggle-btn');
  const $intervalIn = document.getElementById('aad-interval-input');
  const $chkApprove = document.getElementById('aad-chk-approve');
  const $chkSkip    = document.getElementById('aad-chk-skip');
  const $chkSaveLog = document.getElementById('aad-chk-savelog');
  const $dlLogBtn   = document.getElementById('aad-dl-log-btn');
  const $logPath    = document.getElementById('aad-log-path');
  const $statusText = document.getElementById('aad-status-text');
  const $sessionCnt = document.getElementById('aad-session-cnt');
  const $totalCnt   = document.getElementById('aad-total-cnt');
  const $log        = document.getElementById('aad-log');
  const $header     = document.getElementById('aad-header');

  // Show/hide log path hint based on cfgSaveLog
  if (cfgSaveLog) $logPath.style.display = 'block';

  // ── Draggable ─────────────────────────────────────────────────────────────
  let dragging = false, dx = 0, dy = 0;
  $header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    // Convert current position to top/left before starting drag
    const rect = panel.getBoundingClientRect();
    panel.style.top    = rect.top + 'px';
    panel.style.left   = rect.left + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    // Clamp to viewport
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    const x = Math.max(0, Math.min(e.clientX - dx, maxX));
    const y = Math.max(0, Math.min(e.clientY - dy, maxY));
    panel.style.left = x + 'px';
    panel.style.top  = y + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // ── Reset to bottom-right on double-click header ──────────────────────────
  $header.addEventListener('dblclick', () => {
    panel.style.top    = '';
    panel.style.left   = '';
    panel.style.right  = '16px';
    panel.style.bottom = '16px';
  });

  // ── Minimize / Close ──────────────────────────────────────────────────────
  document.getElementById('aad-min-btn').addEventListener('click', () => {
    panel.classList.toggle('minimized');
  });
  document.getElementById('aad-close-btn').addEventListener('click', () => {
    stop();
    panel.remove();
  });

  // ── Controls ──────────────────────────────────────────────────────────────
  const $tokenBtn = document.getElementById('aad-token-btn');

  // Disable/enable interactive controls based on running state
  function setControlsEnabled(enabled) {
    const els = [$intervalIn, $chkApprove, $chkSkip, $chkSaveLog, $tokenBtn, $dlLogBtn];
    els.forEach((el) => {
      if (enabled) {
        el.disabled = false;
        el.closest('label, div, button')?.classList.remove('aad-disabled');
        el.classList.remove('aad-disabled');
      } else {
        el.disabled = true;
        // For checkboxes inside labels, disable the label visually
        const wrapper = el.closest('label') || el.closest('div#aad-interval-wrap');
        if (wrapper) wrapper.classList.add('aad-disabled');
        if (el.tagName === 'BUTTON') el.classList.add('aad-disabled');
      }
    });
  }

  $toggleBtn.addEventListener('click', () => {
    running ? stop() : start();
  });

  $intervalIn.addEventListener('change', () => {
    interval = Math.max(5, parseInt($intervalIn.value, 10) || 30);
    $intervalIn.value = interval;
    GM_setValue('interval', interval);
  });

  $chkApprove.addEventListener('change', () => {
    cfgApprove = $chkApprove.checked;
    GM_setValue('auto_approve', cfgApprove);
  });

  $chkSkip.addEventListener('change', () => {
    cfgSkip = $chkSkip.checked;
    GM_setValue('auto_skip', cfgSkip);
  });

  $chkSaveLog.addEventListener('change', () => {
    cfgSaveLog = $chkSaveLog.checked;
    GM_setValue('save_log', cfgSaveLog);
    $logPath.style.display = cfgSaveLog ? 'block' : 'none';
    if (cfgSaveLog) {
      addLog(`💾 日志记录已开启 — 文件: aad-run-${RUN_ID}.log`, 'ok');
    } else {
      addLog('💾 日志记录已关闭', 'info');
    }
  });

  $dlLogBtn.addEventListener('click', downloadLog);
  $tokenBtn.addEventListener('click', promptToken);

  // ── Tampermonkey menu commands ────────────────────────────────────────────
  GM_registerMenuCommand('🔑 Set GitHub Token', promptToken);
  GM_registerMenuCommand('🚀 Start Monitoring', start);
  GM_registerMenuCommand('⏹ Stop Monitoring', stop);

  // ═══════════════════════════════════════════════════════════════════════════
  // UI Update Functions
  // ═══════════════════════════════════════════════════════════════════════════
  function renderRunInfo(run) {
    const badgeClass =
      run.status === 'completed'
        ? run.conclusion === 'success'
          ? 'aad-badge-completed'
          : 'aad-badge-failure'
        : run.status === 'in_progress'
          ? 'aad-badge-in_progress'
          : 'aad-badge-queued';

    $info.innerHTML = `
      <strong>${esc(OWNER)}/${esc(REPO)}</strong><br>
      <span class="aad-run-name">${esc(run.name)}</span> · ${esc(run.head_branch)}<br>
      Status: <span class="aad-status-badge ${badgeClass}">${esc(run.status)}${run.conclusion ? ' · ' + esc(run.conclusion) : ''}</span>
    `;
  }

  function renderToggle() {
    if (running) {
      $toggleBtn.textContent = '⏹ Stop';
      $toggleBtn.className = 'stop';
      setControlsEnabled(false);
    } else {
      $toggleBtn.textContent = '▶ Start';
      $toggleBtn.className = 'start';
      setControlsEnabled(true);
    }
  }

  function renderCounters() {
    $sessionCnt.textContent = sessionApproved;
    $totalCnt.textContent = totalApproved;
  }

  function setStatus(html) {
    $statusText.innerHTML = html;
  }

  function addLog(msg, level = 'info') {
    // Console output for DevTools debugging
    const tag = '[AAD]';
    const consoleFn =
      level === 'err' ? console.error :
      level === 'warn' ? console.warn :
      level === 'ok' ? console.info : console.log;
    consoleFn(`${tag} ${msg}`);

    const timeStr = ts();
    // Persist to GM storage if log saving is enabled
    appendLogToStore(`[${timeStr}] [${level}] ${msg}`);

    const entry = document.createElement('div');
    entry.className = 'aad-log-entry';
    entry.innerHTML = `<span class="aad-log-time">${timeStr}</span> <span class="aad-log-${level}">${esc(msg)}</span>`;
    $log.appendChild(entry);
    $log.scrollTop = $log.scrollHeight;

    // Keep log manageable
    while ($log.children.length > 200) {
      $log.removeChild($log.firstChild);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Initialization — fetch run info on load
  // ═══════════════════════════════════════════════════════════════════════════
  (async function init() {
    if (!token) {
      $info.innerHTML = `<span style="color:#d29922">⚠️ No token configured — click <b>🔑 Token</b> to set one.</span>`;
      addLog('No token configured. Click 🔑 Token to set your GitHub token.', 'warn');
      return;
    }
    try {
      const run = await fetchRunInfo();
      renderRunInfo(run);
      totalApproved = 0; // will be counted from jobs below
      try {
        const jobsData = await api(
          'GET',
          `/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/jobs?per_page=100`
        );
        const gateJobs = jobsData.jobs.filter((j) =>
          /gate/i.test(j.name)
        );
        totalApproved = gateJobs.filter(
          (j) => j.conclusion === 'success'
        ).length;
        renderCounters();
      } catch {
        /* non-critical */
      }
      addLog(`Ready — ${OWNER}/${REPO} run #${RUN_ID}`);

      // Auto-resume if was running before page refresh
      if (wasRunning()) {
        addLog('🔄 Resuming after page refresh...', 'ok');
        start();
      }
    } catch (e) {
      $info.innerHTML = `<span style="color:#f85149">❌ Failed to load run info: ${esc(e.message)}</span>`;
      addLog(`Failed to load run info: ${e.message}`, 'err');
    }
  })();
})();
