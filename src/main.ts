/**
 * Main entry — DOM-based deployment approval auto-clicker
 *
 * No GitHub token required. Prefers GitHub's "Review deployments" flow and
 * falls back to the legacy break-glass button. Only activates on Deploy (PRD)
 * workflow runs.
 */
import { parseUrl, isDeployPRDPage, getWorkflowName, type RunParams } from './utils/url';
import { loadConfig, saveConfigField } from './core/config';
import { createState, WATCHDOG_TIMEOUT_MS, type State } from './core/state';
import { initLogStore, downloadLog, clearStoredLogs } from './core/log-store';
import { saveRunningState, wasRunning, saveSession, loadSession, clearSession } from './core/session';
import { scheduleTick, cancelTick } from './core/scheduler';
import { findDeploymentTrigger, trySkipWaitTimers, observeSkipButton } from './api/skip-timers';
import { checkLatestVersion, getCurrentVersion } from './core/version-check';
import { esc } from './utils/helpers';
import { injectStyles } from './ui/styles';
import {
  buildUI, renderRunInfo, renderToggle, renderCounters,
  setStatus, addLog, restoreLogsToPanel, generateSummary,
  type UIElements,
} from './ui/ui';
import { mountOverviewWidget, saveRunMeta, clearRunMeta } from './ui/overview';
import { mountPullRequestWidget } from './ui/pr-overview';

const config = loadConfig();
const state: State = createState();
injectStyles();

let el: UIElements | null = null;
let currentRunId: string | null = null;
let currentMeta: { owner: string; repo: string; runId: string; workflow: string } | null = null;
let skipInProgress = false;
let skipCooldownUntil = 0;
let versionBlocked = false;
let disconnectSkipObserver: (() => void) | null = null;
let statusObserver: MutationObserver | null = null;
let statusPollDebounce: ReturnType<typeof setTimeout> | null = null;
let lastConclusion = '';

// ── Global error capture → log ─────────────────────────────
window.addEventListener('error', (e) => {
  const msg = e.error?.stack || e.message || String(e);
  if (/aad|auto[-_]?approve/i.test(msg) || (e.filename || '').includes('user.js')) {
    log(`💥 Uncaught error: ${msg.slice(0, 300)}`, 'err');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason?.stack || e.reason?.message || String(e.reason);
  log(`💥 Unhandled rejection: ${String(reason).slice(0, 300)}`, 'err');
});

// ── bfcache restore → re-init ──────────────────────────────
window.addEventListener('pageshow', (e) => {
  if ((e as PageTransitionEvent).persisted) {
    log('🔄 Page restored from bfcache — re-checking');
    setTimeout(checkPage, 200);
  }
});

// ── Helpers ────────────────────────────────────────────────
function log(msg: string, level?: string): void {
  if (el) addLog(el, msg, level);
  else console.log(`[AAD] ${msg}`);
}

function recordEvent(type: string, detail: string): void {
  if (!state.startRunId) return;
  state.sessionEvents.push({ ts: Date.now(), type, detail });
  saveSession(state.startRunId, state);
}

// ── RunId guard ────────────────────────────────────────────
/** Returns true if the current page URL still matches the run we started on. */
function runIdMatches(): boolean {
  if (!state.startRunId) return false;
  const cur = parseUrl();
  return !!cur && cur.runId === state.startRunId;
}

function abortIfDrifted(): boolean {
  if (!state.running) return false;
  if (runIdMatches()) return true;
  const cur = parseUrl();
  const where = cur ? `${cur.owner}/${cur.repo}/runs/${cur.runId}` : location.pathname;
  log(`⚠️ URL drift: started on run #${state.startRunId} but now at ${where}`, 'warn');
  log('⏹ Auto-stopped to avoid acting on the wrong action.', 'err');
  if (el) setStatus(el, `⚠️ Stopped: URL changed away from run #${state.startRunId}`);
  stop();
  return false;
}

// ── Deployment approval observer & poll ────────────────────
async function handleSkipDetected(): Promise<void> {
  if (skipInProgress || !state.running || state.paused) return;
  if (Date.now() < skipCooldownUntil) return;
  if (!abortIfDrifted()) return;

  skipInProgress = true;
  try {
    const triggerLabel = findDeploymentTrigger()?.label || 'deployment approval control';
    log(`[detect] "${triggerLabel}" found in DOM`);
    const cur = parseUrl();
    if (!cur) return;
    const ok = await trySkipWaitTimers(cur.owner, cur.repo, log, true);
    if (!abortIfDrifted()) return;
    if (ok) {
      log('✅ Click executed successfully', 'ok');
      state.sessionApproved++;
      state.sessionSkipped++;
      state.totalApproved++;
      state.lastProgressAt = Date.now();
      recordEvent('approve', `Approved deployments via "${triggerLabel}"`);
      if (el) renderCounters(el, state);
      saveSession(state.startRunId!, state);
      // brief cooldown to avoid double-firing
      skipCooldownUntil = Date.now() + 5_000;
    } else {
      log('⚠️ Click failed — will retry on next poll cycle', 'warn');
      skipCooldownUntil = Date.now() + 15_000;
    }
  } catch (e) {
    log(`⚠️ Click error: ${(e as Error).message}`, 'warn');
    skipCooldownUntil = Date.now() + 15_000;
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

// Observe the run-header status icon for changes and trigger an immediate poll
// when it mutates. GitHub pushes header updates via socket channels (see the
// `.js-updatable-content` wrapper); without this observer, conclusion changes
// are only picked up on the next poll tick (default 15s).
function startStatusObserver(): void {
  stopStatusObserver();
  // Re-attach periodically because GitHub may replace the container subtree on
  // socket pushes. Walk up to find the most stable ancestor we can observe.
  const target =
    document.querySelector('.js-updatable-content[data-url*="header_partial"]') ||
    document.querySelector('.actions-workflow-runs-status')?.closest('page-header') ||
    document.querySelector('page-header') ||
    document.body;
  if (!target) return;
  statusObserver = new MutationObserver(() => {
    if (statusPollDebounce) clearTimeout(statusPollDebounce);
    statusPollDebounce = setTimeout(() => {
      statusPollDebounce = null;
      if (state.running && !state.paused) {
        void poll();
      }
    }, 200);
  });
  statusObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'class'] });
}

function stopStatusObserver(): void {
  if (statusObserver) {
    statusObserver.disconnect();
    statusObserver = null;
  }
  if (statusPollDebounce) {
    clearTimeout(statusPollDebounce);
    statusPollDebounce = null;
  }
}

// ── Periodic poll (fallback: detect when observer misses) ──
async function poll(): Promise<void> {
  if (!state.running) return;
  if (state.paused) {
    // While paused, just reschedule a heartbeat
    scheduleTick(poll, config.interval * 1000);
    return;
  }
  if (!abortIfDrifted()) return;

  state.pollCycle++;
  saveRunningState(state.startRunId!, true);

  // Auto-stop when workflow has reached a terminal conclusion
  const conclusion = readRunConclusion();
  if (conclusion && conclusion !== lastConclusion) {
    log(`🔍 Run status detected: ${conclusion}`);
    lastConclusion = conclusion;
  }
  if (isTerminalConclusion(conclusion)) {
    log(`🏁 Workflow ${conclusion} — stopping and generating report`, 'ok');
    stop(false);
    return;
  }

  // Watchdog: if no progress for WATCHDOG_TIMEOUT_MS, reload page to recover from stuck state
  if (state.lastProgressAt > 0 && Date.now() - state.lastProgressAt >= WATCHDOG_TIMEOUT_MS) {
    const mins = Math.round(WATCHDOG_TIMEOUT_MS / 60000);
    log(`⏱️ Watchdog: no progress for ${mins} min — reloading page to recover...`, 'warn');
    // Persist a fresh baseline before reloading. Otherwise resume() restores
    // the already-expired timestamp and immediately enters another reload.
    state.lastProgressAt = Date.now();
    recordEvent('error', `Watchdog reload after ${mins} min of no progress`);
    saveSession(state.startRunId!, state);
    saveRunningState(state.startRunId!, true);
    setTimeout(() => location.reload(), 300);
    return;
  }

  // Check DOM for the approval control as a fallback.
  const trigger = findDeploymentTrigger();

  if (trigger && !skipInProgress && Date.now() >= skipCooldownUntil) {
    log(`[poll #${state.pollCycle}] "${trigger.label}" present — triggering click`);
    handleSkipDetected();
  } else {
    if (el) setStatus(el, `🔄 Monitoring (cycle ${state.pollCycle})...`);
    // Heartbeat every 4 cycles (≈ 1 min @15s) so the log proves the loop is alive
    if (state.pollCycle % 4 === 0) {
      log(`💓 poll #${state.pollCycle} — status: ${conclusion || 'unknown'}`);
    }
  }

  if (state.running) {
    scheduleTick(poll, config.interval * 1000);
  }
}

// ── Lifecycle ──────────────────────────────────────────────
function start(): void {
  if (versionBlocked) {
    log('⛔ Cannot start: outdated version. Please update first.', 'err');
    return;
  }
  const cur = parseUrl();
  if (!cur) {
    log('⚠️ Not on an action run page', 'warn');
    return;
  }
  state.running = true;
  state.paused = false;
  state.startRunId = cur.runId;
  state.sessionApproved = 0;
  state.sessionSkipped = 0;
  state.sessionEvents = [];
  state.lastSkipKey = '';
  state.pollCycle = 0;
  state.monitorStartedAt = Date.now();
  state.lastProgressAt = Date.now();
  lastConclusion = '';
  clearSession(cur.runId);
  clearStoredLogs();
  if (el) el.$log.innerHTML = '';
  saveRunningState(cur.runId, true);
  if (currentMeta) saveRunMeta(cur.runId, currentMeta);
  if (el) el.$summary.classList.remove('aad-visible');
  recordEvent('start', `Started on run #${cur.runId} (interval=${config.interval}s)`);
  log(`🚀 Started monitoring run #${cur.runId} (interval=${config.interval}s)`);
  if (el) renderToggle(el, true, false);
  startSkipObserver();
  startStatusObserver();
  poll();
}

function resume(): void {
  if (versionBlocked) {
    log('⛔ Cannot resume: outdated version. Please update first.', 'err');
    return;
  }
  const cur = parseUrl();
  if (!cur) return;
  state.running = true;
  state.paused = false;
  state.startRunId = cur.runId;
  loadSession(cur.runId, state);
  if (!state.lastProgressAt) state.lastProgressAt = Date.now();
  saveRunningState(cur.runId, true);
  if (currentMeta) saveRunMeta(cur.runId, currentMeta);
  if (el) el.$summary.classList.remove('aad-visible');
  recordEvent('resume', `Resumed after page refresh`);
  log(`🚀 Resumed monitoring run #${cur.runId} (interval=${config.interval}s)`);
  if (el) {
    renderToggle(el, true, false);
    renderCounters(el, state);
  }
  startSkipObserver();
  startStatusObserver();
  poll();
}

function pauseMonitoring(): void {
  if (!state.running || state.paused) return;
  state.paused = true;
  stopSkipObserver();
  stopStatusObserver();
  cancelTick();
  if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
  log('⏸ Paused — click Resume to continue', 'warn');
  if (state.startRunId) saveSession(state.startRunId, state);
  if (el) {
    renderToggle(el, true, true);
    setStatus(el, '⏸ Paused');
  }
  // Heartbeat so unpause check still wakes us
  scheduleTick(poll, config.interval * 1000);
}

function resumeMonitoring(): void {
  if (!state.running || !state.paused) return;
  state.paused = false;
  state.lastProgressAt = Date.now(); // reset watchdog after pause
  log('▶ Resumed', 'ok');
  if (el) renderToggle(el, true, false);
  startSkipObserver();
  startStatusObserver();
  poll();
}

/** Best-effort read of workflow run conclusion from the page DOM. */
function readRunConclusion(): string {
  // Authoritative: the run-level status icon lives inside the PageHeader's
  // `.actions-workflow-runs-status` container. If we find it, trust it —
  // never fall back to a global scan, which can pick up unrelated icons
  // (e.g. per-attempt success icons in the "Latest #N" dropdown overlay,
  // or per-job status icons further down the page).
  const runHeaderSelectors = [
    '.actions-workflow-runs-status svg[aria-label]',
    '[data-testid="workflow-run-status"] svg[aria-label]',
  ];
  for (const sel of runHeaderSelectors) {
    const node = document.querySelector<Element>(sel);
    if (node) {
      // Element is authoritative — return whatever it maps to, or default
      // to 'in_progress' (the run is rendering, just no terminal class yet).
      return mapConclusionEl(node) || 'in_progress';
    }
  }

  // Fallback: text-based "Status" pill for legacy layouts where the icon
  // container above is absent.
  const statePill = document.querySelector<HTMLElement>(
    'span[class*="State--"], [class*="StatusBadge"], [class*="status-badge"]'
  );
  if (statePill) {
    const c = mapConclusionFromText(statePill.textContent || '');
    if (c) return c;
  }

  return '';
}

function mapConclusionEl(el: Element): string {
  const label = (el.getAttribute('aria-label') || '').toLowerCase();
  const cls = el.getAttribute('class') || '';
  if (label) {
    const c = mapConclusionFromText(label);
    if (c) return c;
  }
  if (/color-fg-success/.test(cls)) return 'success';
  if (/color-fg-danger/.test(cls)) return 'failure';
  if (/color-fg-attention/.test(cls)) return 'action_required';
  if (/color-fg-muted/.test(cls)) return 'cancelled';
  return '';
}

function mapConclusionFromText(text: string): string {
  const t = text.toLowerCase();
  if (/success/.test(t)) return 'success';
  if (/failure|failed/.test(t)) return 'failure';
  if (/cancel/.test(t)) return 'cancelled';
  if (/timed.?out/.test(t)) return 'timed_out';
  if (/skipped/.test(t)) return 'skipped';
  if (/action.?required/.test(t)) return 'action_required';
  if (/in.?progress|currently.?running|running|queued|waiting|pending|requested/.test(t)) return 'in_progress';
  return '';
}

/** Returns true if conclusion indicates the run finished (no more work expected). */
function isTerminalConclusion(c: string): boolean {
  return c === 'success' || c === 'failure' || c === 'cancelled' || c === 'timed_out' || c === 'skipped';
}

function stop(manual = true): void {
  state.running = false;
  state.paused = false;
  if (state.startRunId) saveRunningState(state.startRunId, false);
  if (state.startRunId) clearRunMeta(state.startRunId);
  stopSkipObserver();
  stopStatusObserver();
  cancelTick();
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  log(`⏹ Stopped (cycles=${state.pollCycle}, clicks=${state.sessionApproved})`);
  const conclusion = readRunConclusion() || (manual ? 'stopped' : 'unknown');
  recordEvent('complete', `Stopped — ${conclusion} (duration=${Math.round((Date.now() - state.monitorStartedAt) / 1000)}s)`);
  if (state.startRunId) saveSession(state.startRunId, state);
  if (el) {
    renderToggle(el, false);
    generateSummary(el, state, config, conclusion, currentMeta || undefined);
  }
  notifyCompletion(conclusion, manual);
}

function notifyCompletion(conclusion: string, manual: boolean): void {
  if (manual && conclusion === 'stopped') return; // don't notify on manual stop
  try {
    const icon = conclusion === 'success' ? '✅'
               : conclusion === 'failure' ? '❌'
               : conclusion === 'cancelled' ? '⚠️'
               : '🏁';
    const where = currentMeta ? `${currentMeta.owner}/${currentMeta.repo}` : 'workflow';
    const text = `Run #${currentMeta?.runId || state.startRunId || ''} — ${conclusion}\n✅ ${state.sessionApproved} · ⏱ ${Math.round((Date.now() - state.monitorStartedAt) / 1000)}s`;
    GM_notification({
      title: `${icon} AAD — ${where}`,
      text,
      timeout: 10000,
      onclick: () => { try { window.focus(); } catch { /* noop */ } },
    });
  } catch (e) {
    log(`Notification failed: ${(e as Error).message}`, 'warn');
  }
}

// ── Panel build/teardown (driven by page detection) ────────
function bindPanelEvents(panel: UIElements, runId: string): void {
  panel.$toggleBtn.addEventListener('click', () => {
    state.running ? stop() : start();
  });

  panel.$pauseBtn.addEventListener('click', () => {
    state.paused ? resumeMonitoring() : pauseMonitoring();
  });

  panel.$intervalIn.addEventListener('change', () => {
    config.interval = Math.max(5, parseInt(panel.$intervalIn.value, 10) || 15);
    panel.$intervalIn.value = String(config.interval);
    saveConfigField('interval', config.interval);
  });

  panel.$chkSaveLog.addEventListener('change', () => {
    config.saveLog = panel.$chkSaveLog.checked;
    saveConfigField('saveLog', config.saveLog);
    panel.$logPath.classList.toggle('aad-visible', config.saveLog);
    log(config.saveLog ? `💾 日志记录已开启 — 文件: aad-run-${runId}.log` : '💾 日志记录已关闭', config.saveLog ? 'ok' : 'info');
  });

  panel.$dlLogBtn.addEventListener('click', () => downloadLog(runId));
}

function buildPanelFor(params: RunParams): void {
  initLogStore(params.runId);
  el = buildUI(params.runId, config);
  bindPanelEvents(el, params.runId);
  const workflow = getWorkflowName() || 'Deploy (PRD)';
  currentMeta = { owner: params.owner, repo: params.repo, runId: params.runId, workflow };
  renderRunInfo(el, currentMeta);
  // Render historical logs FIRST so they appear above the new session entries.
  // restoreLogsToPanel itself adds the "── 以下为刷新前日志 ──" + "── 当前会话开始 ──"
  // separators, so any log() call afterwards lands cleanly under the new session.
  restoreLogsToPanel(el);
  log(`Ready — ${params.owner}/${params.repo} run #${params.runId}`);
  currentRunId = params.runId;

  // Skip the version check when we're about to resume an in-flight run — the
  // outdated-version banner would only add noise during active monitoring and
  // the network call is wasted. The next idle mount (no resume) will check.
  if (wasRunning(params.runId)) {
    log('🔄 Resuming after page refresh...', 'ok');
    resume();
  } else {
    runVersionCheck();
  }
}

function teardownPanel(): void {
  if (state.running) stop();
  if (el) {
    el.panel.remove();
    el.tab.remove();
    el = null;
  }
  currentRunId = null;
  currentMeta = null;
}

async function runVersionCheck(): Promise<void> {
  if (!el) return;
  const currentVersion = getCurrentVersion();
  try {
    const v = await checkLatestVersion(currentVersion);
    if (v.outdated) {
      versionBlocked = true;
      const installUrl = `https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js`;
      const notesHtml = v.releaseNotes
        ? `<details open class="aad-version-notes"><summary class="aad-version-notes-summary">📋 v${esc(v.latest)} 更新内容</summary>
             <div class="aad-version-notes-body">${esc(v.releaseNotes)}</div>
           </details>`
        : '';
      el.$info.innerHTML = `<div class="aad-version-error">⛔ 脚本版本过期，请更新后使用</div>
        <div class="aad-version-current">当前: <code>${esc(v.current)}</code> · 最新: <code>${esc(v.latest)}</code></div>
        <div class="aad-version-actions">
          <a href="${esc(installUrl)}" target="_blank" rel="noopener" class="aad-version-install">📥 安装最新版本</a>
          <a href="${esc(v.releaseUrl)}" target="_blank" rel="noopener" class="aad-version-release">查看 Release 页</a>
        </div>
        ${notesHtml}`;
      log(`⛔ Outdated: ${v.current} → ${v.latest}. Update required.`, 'err');
      // Disable all functional controls — only the install link remains usable
      el.$toggleBtn.disabled = true;
      el.$toggleBtn.textContent = '⛔ Outdated';
      el.$intervalIn.disabled = true;
      el.$chkSaveLog.disabled = true;
      el.$dlLogBtn.disabled = true;
      return;
    }
    log(`✅ Version check passed (${v.current})`, 'ok');
  } catch (e) {
    log(`⚠️ Version check failed: ${(e as Error).message} — proceeding anyway`, 'warn');
  }
}

// ── SPA-aware page watcher ─────────────────────────────────
function checkPage(): void {
  const params = parseUrl();
  const onTarget = !!params && isDeployPRDPage();

  if (!onTarget) {
    if (el) teardownPanel();
    mountOverviewWidget(false);
    mountPullRequestWidget(location.pathname === '/');
    return;
  }

  // On target page
  if (!el || currentRunId !== params!.runId) {
    if (el) teardownPanel();
    buildPanelFor(params!);
  }
  mountOverviewWidget(true);
  mountPullRequestWidget(false);
}

// Initial + repeated checks (page may load Deploy (PRD) header after document-idle)
checkPage();
let initialTries = 0;
const initialPoll = setInterval(() => {
  initialTries++;
  checkPage();
  if (el || initialTries >= 20) clearInterval(initialPoll);
}, 500);

// SPA navigation (Turbo)
document.addEventListener('turbo:load', () => checkPage());
document.addEventListener('turbo:render', () => checkPage());

// URL change fallback (covers history.pushState that doesn't fire turbo:load)
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    setTimeout(checkPage, 400);
  }
}, 1000);

// ── Tampermonkey menu commands ─────────────────────────────
GM_registerMenuCommand('🚀 Start Monitoring', () => { if (el) start(); });
GM_registerMenuCommand('⏹ Stop Monitoring', () => { if (el) stop(); });
