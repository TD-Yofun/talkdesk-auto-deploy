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
  let interval   = GM_getValue('interval', 15);
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
  let pollCycle        = 0;   // incremental poll counter for log tracing
  let sessionSkipped   = 0;   // skip timer attempts this session
  let sessionEvents    = [];  // timeline: [{ts, type, detail}]
  const GRACE_PERIOD   = 90;  // seconds to wait for re-run to propagate

  // Log persistence per run
  const logStoreKey = `aad_log_${RUN_ID}`;
  let _logBuffer = [];  // batch buffer to reduce GM_setValue calls
  let _logFlushTimer = null;
  function _flushLogBuffer() {
    if (_logBuffer.length === 0) return;
    const arr = GM_getValue(logStoreKey, []);
    // Migration: handle old string format
    const existing = typeof arr === 'string'
      ? (arr ? arr.split('\n').filter(Boolean) : [])
      : arr;
    existing.push(..._logBuffer);
    // Cap at 2000 entries
    if (existing.length > 2000) existing.splice(0, existing.length - 2000);
    GM_setValue(logStoreKey, existing);
    _logBuffer = [];
  }
  function appendLogToStore(line) {
    if (!cfgSaveLog) return;
    _logBuffer.push(line);
    // Debounce: flush after 500ms of no new writes, or immediately if buffer is large
    if (_logBuffer.length >= 20) {
      _flushLogBuffer();
    } else {
      clearTimeout(_logFlushTimer);
      _logFlushTimer = setTimeout(_flushLogBuffer, 500);
    }
  }
  function getStoredLogs() {
    // Flush any pending buffer first
    _flushLogBuffer();
    const data = GM_getValue(logStoreKey, []);
    // Migration: handle old string format
    if (typeof data === 'string') {
      return data ? data.split('\n').filter(Boolean) : [];
    }
    return data;
  }
  function downloadLog() {
    const lines = getStoredLogs();
    if (lines.length === 0) {
      alert('当前 Run 暂无日志记录');
      return;
    }
    const content = lines.join('\n') + '\n';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aad-run-${RUN_ID}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function restoreLogsToPanel() {
    const lines = getStoredLogs();
    if (lines.length === 0) return;
    // Show a separator and last N lines
    const maxRestore = 50;
    const recent = lines.slice(-maxRestore);
    const $log = document.getElementById('aad-log');
    if (!$log) return;
    const sep = document.createElement('div');
    sep.className = 'aad-log-entry';
    sep.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 以下为刷新前日志 (最近 ${recent.length}/${lines.length} 条) ──</span>`;
    $log.appendChild(sep);
    recent.forEach((line) => {
      // Parse stored format: [HH:MM:SS] [level] msg
      const m = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
      const entry = document.createElement('div');
      entry.className = 'aad-log-entry';
      if (m) {
        entry.innerHTML = `<span class="aad-log-time">${esc(m[1])}</span> <span class="aad-log-${m[2]}">${esc(m[3])}</span>`;
      } else {
        entry.innerHTML = `<span class="aad-log-info">${esc(line)}</span>`;
      }
      $log.appendChild(entry);
    });
    const sep2 = document.createElement('div');
    sep2.className = 'aad-log-entry';
    sep2.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 当前会话开始 ──</span>`;
    $log.appendChild(sep2);
    $log.scrollTop = $log.scrollHeight;
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
    const savedTs = GM_getValue(stateKey, 0);
    // Consider stale if saved more than 30 minutes ago (page was probably closed)
    return savedTs > 0 && (Date.now() - savedTs) < 30 * 60 * 1000;
  }

  // Persist session counters across page refreshes
  const sessionKey = `aad_session_${RUN_ID}`;
  function saveSession() {
    GM_setValue(sessionKey, {
      approved: sessionApproved,
      skipped: sessionSkipped,
      events: sessionEvents,
      startedAt: monitorStartedAt,
      pollCycle,
      lastSkipKey,
    });
  }
  function loadSession() {
    const s = GM_getValue(sessionKey, null);
    if (!s) return false;
    sessionApproved  = s.approved  || 0;
    sessionSkipped   = s.skipped   || 0;
    sessionEvents    = s.events    || [];
    monitorStartedAt = s.startedAt || Date.now();
    pollCycle        = s.pollCycle || 0;
    lastSkipKey      = s.lastSkipKey || '';
    return true;
  }
  function clearSession() {
    GM_setValue(sessionKey, null);
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

  function recordEvent(type, detail) {
    sessionEvents.push({ ts: Date.now(), type, detail });
    saveSession();
  }

  function formatDuration(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remSecs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  }

  function generateSummary(conclusion) {
    const duration = Date.now() - monitorStartedAt;
    const $summary = document.getElementById('aad-summary');
    if (!$summary) return;

    const timelineHtml = sessionEvents.map((ev) => {
      const t = new Date(ev.ts).toLocaleTimeString('en-US', { hour12: false });
      const icon = ev.type === 'approve' ? '✅' :
                   ev.type === 'skip' ? '⏭' :
                   ev.type === 'error' ? '❌' :
                   ev.type === 'start' ? '🚀' :
                   ev.type === 'resume' ? '🔄' :
                   ev.type === 'complete' ? '🏁' : '📌';
      return `<div class="aad-timeline-item"><span class="aad-log-time">${t}</span> ${icon} ${esc(ev.detail)}</div>`;
    }).join('');

    const ok = conclusion === 'success';
    const statusIcon = ok ? '✅' : '❌';
    const statusClass = ok ? 'aad-log-ok' : 'aad-log-err';

    $summary.innerHTML = `
      <div class="aad-summary-header">📊 执行报告</div>
      <div class="aad-summary-grid">
        <div class="aad-summary-item">
          <span class="aad-summary-label">结果</span>
          <span class="${statusClass}">${statusIcon} ${esc(conclusion || 'unknown')}</span>
        </div>
        <div class="aad-summary-item">
          <span class="aad-summary-label">总耗时</span>
          <span>${formatDuration(duration)}</span>
        </div>
        <div class="aad-summary-item">
          <span class="aad-summary-label">轮询次数</span>
          <span>${pollCycle}</span>
        </div>
        <div class="aad-summary-item">
          <span class="aad-summary-label">审批通过</span>
          <span class="aad-log-ok">${sessionApproved}</span>
        </div>
        <div class="aad-summary-item">
          <span class="aad-summary-label">跳过计时器</span>
          <span>${sessionSkipped}</span>
        </div>
        <div class="aad-summary-item">
          <span class="aad-summary-label">轮询间隔</span>
          <span>${interval}s</span>
        </div>
      </div>
      ${sessionEvents.length > 0 ? `
        <div class="aad-summary-header" style="margin-top:8px">📋 执行时间线</div>
        <div class="aad-timeline">${timelineHtml}</div>
      ` : ''}
    `;
    $summary.style.display = 'block';
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
        comment: 'Auto-approved by Auto-Approve Deploy Gates',
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

            // Wait for form submission to process
            await new Promise((r) => setTimeout(r, 3000));
            return true;
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
    pollCycle++;
    // Keep running-state timestamp fresh so it survives page reloads
    saveRunningState(true);
    addLog(`[poll #${pollCycle}] polling...`);
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
          // Skip pending fetch during grace period — run is "completed" so nothing to do
          if (running) {
            pollTimer = setTimeout(poll, interval * 1000);
          }
          return;
        } else {
          const ok = run.conclusion === 'success';
          recordEvent('complete', `Run ${ok ? 'succeeded' : 'failed'}: ${run.conclusion}`);
          addLog(
            ok
              ? `✅ Run completed! (session: ${sessionApproved}, total: ${totalApproved})`
              : `❌ Run finished: ${run.conclusion} (session: ${sessionApproved}, total: ${totalApproved})`,
            ok ? 'ok' : 'err'
          );
          generateSummary(run.conclusion);
          stop();
          return;
        }
      }

      // 2. Fetch pending deployments
      const pending = await fetchPending();
      const approvable = pending.filter(
        (d) => d.current_user_can_approve
      );

      addLog(`[poll] status=${run.status}, pending=${pending.length}, approvable=${approvable.length}`);

      // 3. Auto-approve
      if (cfgApprove && approvable.length > 0) {
        const envIds = approvable.map((d) => d.environment.id);
        const envNames = approvable
          .map((d) => d.environment.name)
          .join(', ');
        addLog(`Found ${approvable.length} approvable gate(s): ${envNames}`);

        try {
          await approveDeployments(envIds);
          addLog(`✅ Approved: ${envNames}`, 'ok');
          sessionApproved += approvable.length;
          totalApproved += approvable.length;
          recordEvent('approve', `Approved: ${envNames}`);
          renderCounters();
          // No page refresh needed — API-only, schedule quick re-poll
          if (running) {
            pollTimer = setTimeout(poll, 5000);
          }
          return;
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
              sessionSkipped++;
              recordEvent('skip', `Skipped wait timers: ${skipKey}`);
              saveSession();
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
    sessionSkipped = 0;
    sessionEvents = [];
    lastSkipKey = '';
    pollCycle = 0;
    monitorStartedAt = Date.now();
    clearSession();
    saveRunningState(true);
    // Hide previous summary
    const $summary = document.getElementById('aad-summary');
    if ($summary) $summary.style.display = 'none';
    recordEvent('start', `Started (interval=${interval}s, approve=${cfgApprove}, skip=${cfgSkip})`);
    addLog(`🚀 Started monitoring (interval=${interval}s, approve=${cfgApprove}, skip=${cfgSkip}, log=${cfgSaveLog})`);
    renderToggle();
    poll();
  }

  function resume() {
    if (!token) {
      promptToken();
      return;
    }
    running = true;
    loadSession();
    saveRunningState(true);
    // Hide previous summary
    const $summary = document.getElementById('aad-summary');
    if ($summary) $summary.style.display = 'none';
    recordEvent('resume', `Resumed after page refresh`);
    addLog(`🚀 Started monitoring (interval=${interval}s, approve=${cfgApprove}, skip=${cfgSkip}, log=${cfgSaveLog})`);
    renderToggle();
    renderCounters();
    poll();
  }

  function stop() {
    running = false;
    saveRunningState(false);
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    addLog(`⏹ Stopped (cycles=${pollCycle}, session=${sessionApproved})`);
    saveSession();  // persist final state for summary
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Build UI
  // ═══════════════════════════════════════════════════════════════════════════
  const panel = document.createElement('div');
  panel.id = 'aad-panel';
  panel.innerHTML = `
    <div id="aad-header">
      <span class="aad-title">🚀 Auto-Approve Deploy</span>
      <span class="aad-btns">
        <button id="aad-collapse-btn" title="Collapse panel">▶</button>
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
      <div id="aad-summary"></div>
      <div id="aad-log"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // ── Collapse Tab (always visible on right edge) ───────────────────────────
  const tab = document.createElement('div');
  tab.id = 'aad-tab';
  tab.className = 'shifted';
  tab.textContent = '◀ AAD';
  tab.title = 'Toggle Auto-Approve Deploy panel';
  document.body.appendChild(tab);

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

  // Show/hide log path hint based on cfgSaveLog
  if (cfgSaveLog) $logPath.style.display = 'block';

  // ── Collapse / Expand ─────────────────────────────────────────────────────
  function togglePanel() {
    const isCollapsed = panel.classList.toggle('collapsed');
    tab.classList.toggle('shifted', !isCollapsed);
    tab.textContent = isCollapsed ? '◀ AAD' : '▶';
  }

  tab.addEventListener('click', togglePanel);
  document.getElementById('aad-collapse-btn').addEventListener('click', togglePanel);
  document.getElementById('aad-close-btn').addEventListener('click', () => {
    stop();
    panel.remove();
    tab.remove();
  });

  // ── Controls ──────────────────────────────────────────────────────────────
  const $tokenBtn = document.getElementById('aad-token-btn');

  // Disable/enable interactive controls based on running state
  function setControlsEnabled(enabled) {
    // Checkboxes + interval input: disable and grey out their parent label/wrap
    const checkboxes = [$chkApprove, $chkSkip, $chkSaveLog];
    checkboxes.forEach((cb) => {
      cb.disabled = !enabled;
      const label = cb.closest('label');
      if (label) label.classList.toggle('aad-disabled', !enabled);
    });
    $intervalIn.disabled = !enabled;
    const wrap = $intervalIn.closest('#aad-interval-wrap');
    if (wrap) wrap.classList.toggle('aad-disabled', !enabled);
    // Buttons
    [$tokenBtn, $dlLogBtn].forEach((btn) => {
      btn.disabled = !enabled;
      btn.classList.toggle('aad-disabled', !enabled);
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

      // Restore previous session logs to panel if log saving is on
      if (cfgSaveLog) {
        restoreLogsToPanel();
      }

      // Auto-resume if was running before page refresh
      if (wasRunning()) {
        addLog('🔄 Resuming after page refresh...', 'ok');
        resume();
      }
    } catch (e) {
      $info.innerHTML = `<span style="color:#f85149">❌ Failed to load run info: ${esc(e.message)}</span>`;
      addLog(`Failed to load run info: ${e.message}`, 'err');
    }
  })();
})();
