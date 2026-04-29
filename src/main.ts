/**
 * Main entry — wires all modules together
 */
import { parseUrl } from './utils/url';
import { loadConfig, saveConfigField, type Config } from './core/config';
import { createState, GRACE_PERIOD, type State } from './core/state';
import { initLogStore, setLogSaving, downloadLog } from './core/log-store';
import { saveRunningState, wasRunning, saveSession, loadSession, clearSession } from './core/session';
import { fetchRunInfo, fetchPending, approveDeployments, skipWaitTimersViaApi, fetchJobs } from './api/api';
import { trySkipWaitTimers, observeSkipButton } from './api/skip-timers';
import { esc } from './utils/helpers';
import { injectStyles } from './ui/styles';
import {
  buildUI, renderRunInfo, renderToggle, renderCounters,
  setStatus, addLog, restoreLogsToPanel, generateSummary,
  type UIElements,
} from './ui/ui';

const params = parseUrl();
if (params) {
  const { owner, repo, runId } = params;
  const config = loadConfig();
  const state = createState();

  initLogStore(runId, config.saveLog);
  injectStyles();

  const el = buildUI(runId, config);

  // ── Bound helpers ────────────────────────────────────────
  const log = (msg: string, level?: string) => addLog(el, msg, level);

  let skipInProgress = false;
  let skipCooldownUntil = 0;
  let disconnectSkipObserver: (() => void) | null = null;

  function recordEvent(type: string, detail: string): void {
    state.sessionEvents.push({ ts: Date.now(), type, detail });
    saveSession(runId, state);
  }

  // ── Skip observer (MutationObserver-based) ────────────────
  async function handleSkipDetected(): Promise<void> {
    if (skipInProgress || !state.running || !config.autoSkip) return;
    if (Date.now() < skipCooldownUntil) return;
    skipInProgress = true;
    log('[skip-observer] Detected "Start all waiting jobs" button in DOM');
    try {
      const skipped = await trySkipWaitTimers(owner, repo, log, true);
      if (skipped) {
        log('✅ Skip attempted (observer) — refreshing...', 'ok');
        state.sessionSkipped++;
        recordEvent('skip', 'Skipped wait timers (observer/DOM)');
        saveSession(runId, state);
        softRefresh();
      } else {
        log('⚠️ DOM skip failed (observer). Trying API-based skip...', 'warn');
        try {
          const pending = await fetchPending(owner, repo, runId, config.token);
          const waitGates = pending.filter(
            (d) => !d.current_user_can_approve && d.wait_timer && d.wait_timer > 0
          );
          if (waitGates.length > 0) {
            const envIds = waitGates.map((d) => d.environment.id);
            const envNames = waitGates.map((d) => d.environment.name).join(', ');
            await skipWaitTimersViaApi(owner, repo, runId, config.token, envIds);
            log(`✅ Skipped via API (observer): ${envNames}`, 'ok');
            state.sessionSkipped++;
            recordEvent('skip', `Skipped wait timers (observer/API): ${envNames}`);
            saveSession(runId, state);
          }
        } catch (e) {
          log(`⚠️ API skip also failed (observer): ${(e as Error).message}`, 'warn');
        }
        skipCooldownUntil = Date.now() + 30_000;
      }
    } finally {
      skipInProgress = false;
    }
  }

  function startSkipObserver(): void {
    stopSkipObserver();
    disconnectSkipObserver = observeSkipButton(handleSkipDetected);
  }

  function stopSkipObserver(): void {
    if (disconnectSkipObserver) {
      disconnectSkipObserver();
      disconnectSkipObserver = null;
    }
  }

  // ── Poll loop ────────────────────────────────────────────
  async function poll(): Promise<void> {
    if (!state.running) return;
    state.pollCycle++;
    saveRunningState(runId, true);
    log(`[poll #${state.pollCycle}] polling...`);

    try {
      const run = await fetchRunInfo(owner, repo, runId, config.token);
      renderRunInfo(el, run, owner, repo);

      if (run.status === 'completed') {
        const elapsed = (Date.now() - state.monitorStartedAt) / 1000;
        if (state.sessionApproved === 0 && elapsed < GRACE_PERIOD) {
          const remaining = Math.ceil(GRACE_PERIOD - elapsed);
          log(`⏳ Run shows completed but grace period active (${remaining}s left) — re-run may not have propagated yet`, 'warn');
          setStatus(el, `⏳ Waiting for re-run to start... (${remaining}s)`);
          if (state.running) {
            state.pollTimer = setTimeout(poll, config.interval * 1000);
          }
          return;
        } else {
          const ok = run.conclusion === 'success';
          recordEvent('complete', `Run ${ok ? 'succeeded' : 'failed'}: ${run.conclusion}`);
          log(
            ok
              ? `✅ Run completed! (session: ${state.sessionApproved}, total: ${state.totalApproved})`
              : `❌ Run finished: ${run.conclusion} (session: ${state.sessionApproved}, total: ${state.totalApproved})`,
            ok ? 'ok' : 'err'
          );
          generateSummary(el, state, config, run.conclusion || 'unknown');
          stop();
          return;
        }
      }

      const pending = await fetchPending(owner, repo, runId, config.token);
      const approvable = pending.filter((d) => d.current_user_can_approve);

      log(`[poll] status=${run.status}, pending=${pending.length}, approvable=${approvable.length}`);

      // Auto-approve
      if (config.autoApprove && approvable.length > 0) {
        const envIds = approvable.map((d) => d.environment.id);
        const envNames = approvable.map((d) => d.environment.name).join(', ');
        log(`Found ${approvable.length} approvable gate(s): ${envNames}`);

        try {
          await approveDeployments(owner, repo, runId, config.token, envIds);
          log(`✅ Approved: ${envNames}`, 'ok');
          state.sessionApproved += approvable.length;
          state.totalApproved += approvable.length;
          recordEvent('approve', `Approved: ${envNames}`);
          renderCounters(el, state);
          if (state.running) {
            state.pollTimer = setTimeout(poll, 5000);
          }
          return;
        } catch (e) {
          log(`⚠️ Approve failed: ${(e as Error).message}`, 'warn');
        }
      } else if (pending.length > 0) {
        // Skip wait timers
        const waitGates = pending.filter(
          (d) => !d.current_user_can_approve && d.wait_timer && d.wait_timer > 0
        );

        if (config.autoSkip && waitGates.length > 0 && !skipInProgress) {
          const skipKey = waitGates.map((d) => d.environment.name).sort().join(',');
          if (skipKey !== state.lastSkipKey) {
            state.lastSkipKey = skipKey;
            log(`Detected wait timer(s): ${skipKey}`);
            log('Attempting to skip via page DOM...');
            const skipped = await trySkipWaitTimers(owner, repo, log);
            if (skipped) {
              log('✅ Skip attempted — checking result...', 'ok');
              state.sessionSkipped++;
              recordEvent('skip', `Skipped wait timers (DOM): ${skipKey}`);
              saveSession(runId, state);
              softRefresh();
            } else {
              log('⚠️ DOM skip failed. Trying API-based skip...', 'warn');
              const envIds = waitGates.map((d) => d.environment.id);
              try {
                await skipWaitTimersViaApi(owner, repo, runId, config.token, envIds);
                log(`✅ Skipped via API: ${skipKey}`, 'ok');
                state.sessionSkipped++;
                recordEvent('skip', `Skipped wait timers (API): ${skipKey}`);
                saveSession(runId, state);
                if (state.running) {
                  state.pollTimer = setTimeout(poll, 5000);
                }
                return;
              } catch (e) {
                log(`⚠️ API skip also failed: ${(e as Error).message} — waiting for timer(s) to expire.`, 'warn');
              }
            }
          }
        }

        // Timer countdown
        const timerText = pending
          .filter((d) => !d.current_user_can_approve)
          .map((d) => {
            if (d.wait_timer > 0 && d.wait_timer_started_at) {
              const totalSecs = d.wait_timer * 60;
              const started = new Date(d.wait_timer_started_at).getTime() / 1000;
              const remaining = Math.ceil(started + totalSecs - Date.now() / 1000);
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

        setStatus(el, `⏳ ${pending.length} pending — ${timerText}`);
      } else {
        setStatus(el, `🔄 Monitoring... (${run.status})`);
      }
    } catch (e) {
      log(`⚠️ Poll error: ${(e as Error).message}`, 'warn');
    }

    if (state.running) {
      state.pollTimer = setTimeout(poll, config.interval * 1000);
    }
  }

  function softRefresh(): void {
    log('Refreshing page...');
    location.reload();
  }

  // ── Lifecycle ────────────────────────────────────────────
  function start(): void {
    if (!config.token) {
      promptToken();
      return;
    }
    state.running = true;
    state.sessionApproved = 0;
    state.sessionSkipped = 0;
    state.sessionEvents = [];
    state.lastSkipKey = '';
    state.pollCycle = 0;
    state.monitorStartedAt = Date.now();
    clearSession(runId);
    saveRunningState(runId, true);
    el.$summary.style.display = 'none';
    recordEvent('start', `Started (interval=${config.interval}s, approve=${config.autoApprove}, skip=${config.autoSkip})`);
    log(`🚀 Started monitoring (interval=${config.interval}s, approve=${config.autoApprove}, skip=${config.autoSkip}, log=${config.saveLog})`);
    renderToggle(el, true);
    startSkipObserver();
    poll();
  }

  function resume(): void {
    if (!config.token) {
      promptToken();
      return;
    }
    state.running = true;
    loadSession(runId, state);
    saveRunningState(runId, true);
    el.$summary.style.display = 'none';
    recordEvent('resume', `Resumed after page refresh`);
    log(`🚀 Started monitoring (interval=${config.interval}s, approve=${config.autoApprove}, skip=${config.autoSkip}, log=${config.saveLog})`);
    renderToggle(el, true);
    renderCounters(el, state);
    startSkipObserver();
    poll();
  }

  function stop(): void {
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
  }

  function promptToken(): void {
    const t = prompt('Enter your GitHub token (run `gh auth token` in terminal):', config.token);
    if (t && t.trim()) {
      config.token = t.trim();
      saveConfigField('token', config.token);
      log('🔑 Token saved');
      start();
    }
  }

  // ── Bind events ──────────────────────────────────────────
  document.getElementById('aad-close-btn')!.addEventListener('click', () => {
    stop();
    el.panel.remove();
    el.tab.remove();
  });

  el.$toggleBtn.addEventListener('click', () => {
    state.running ? stop() : start();
  });

  el.$intervalIn.addEventListener('change', () => {
    config.interval = Math.max(5, parseInt(el.$intervalIn.value, 10) || 30);
    el.$intervalIn.value = String(config.interval);
    saveConfigField('interval', config.interval);
  });

  el.$chkApprove.addEventListener('change', () => {
    config.autoApprove = el.$chkApprove.checked;
    saveConfigField('autoApprove', config.autoApprove);
  });

  el.$chkSkip.addEventListener('change', () => {
    config.autoSkip = el.$chkSkip.checked;
    saveConfigField('autoSkip', config.autoSkip);
  });

  el.$chkSaveLog.addEventListener('change', () => {
    config.saveLog = el.$chkSaveLog.checked;
    saveConfigField('saveLog', config.saveLog);
    setLogSaving(config.saveLog);
    el.$logPath.style.display = config.saveLog ? 'block' : 'none';
    if (config.saveLog) {
      log(`💾 日志记录已开启 — 文件: aad-run-${runId}.log`, 'ok');
    } else {
      log('💾 日志记录已关闭', 'info');
    }
  });

  el.$dlLogBtn.addEventListener('click', () => downloadLog(runId));
  el.$tokenBtn.addEventListener('click', promptToken);

  // ── Tampermonkey menu commands ────────────────────────────
  GM_registerMenuCommand('🔑 Set GitHub Token', promptToken);
  GM_registerMenuCommand('🚀 Start Monitoring', start);
  GM_registerMenuCommand('⏹ Stop Monitoring', stop);

  // ── Init ──────────────────────────────────────────────────
  (async function init(): Promise<void> {
    if (!config.token) {
      el.$info.innerHTML = `<span style="color:#d29922">⚠️ No token configured — click <b>🔑 Token</b> to set one.</span>`;
      log('No token configured. Click 🔑 Token to set your GitHub token.', 'warn');
      return;
    }
    try {
      const run = await fetchRunInfo(owner, repo, runId, config.token);
      renderRunInfo(el, run, owner, repo);
      state.totalApproved = 0;
      try {
        const jobsData = await fetchJobs(owner, repo, runId, config.token);
        const gateJobs = jobsData.jobs.filter((j) => /gate/i.test(j.name));
        state.totalApproved = gateJobs.filter((j) => j.conclusion === 'success').length;
        renderCounters(el, state);
      } catch {
        /* non-critical */
      }
      log(`Ready — ${owner}/${repo} run #${runId}`);

      if (config.saveLog) {
        restoreLogsToPanel(el);
      }

      if (wasRunning(runId)) {
        log('🔄 Resuming after page refresh...', 'ok');
        resume();
      }
    } catch (e) {
      el.$info.innerHTML = `<span style="color:#f85149">❌ Failed to load run info: ${esc((e as Error).message)}</span>`;
      log(`Failed to load run info: ${(e as Error).message}`, 'err');
    }
  })();
}
