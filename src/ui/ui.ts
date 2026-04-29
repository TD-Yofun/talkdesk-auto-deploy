/**
 * UI — build panel, bindEvents, render functions
 */
import { esc, ts, formatDuration } from '../utils/helpers';
import { appendLogToStore, getStoredLogs } from '../core/log-store';
import { Config, saveConfigField } from '../core/config';
import type { State } from '../core/state';

export interface UIElements {
  panel: HTMLDivElement;
  tab: HTMLDivElement;
  $info: HTMLElement;
  $toggleBtn: HTMLButtonElement;
  $intervalIn: HTMLInputElement;
  $chkApprove: HTMLInputElement;
  $chkSkip: HTMLInputElement;
  $chkSaveLog: HTMLInputElement;
  $dlLogBtn: HTMLButtonElement;
  $logPath: HTMLElement;
  $statusText: HTMLElement;
  $sessionCnt: HTMLElement;
  $totalCnt: HTMLElement;
  $log: HTMLElement;
  $summary: HTMLElement;
  $tokenBtn: HTMLButtonElement;
}

export function buildUI(runId: string, config: Config): UIElements {
  const panel = document.createElement('div') as HTMLDivElement;
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
          ⏱ <input id="aad-interval-input" type="number" min="5" max="300" value="${config.interval}">s
        </div>
        <label><input type="checkbox" id="aad-chk-approve" ${config.autoApprove ? 'checked' : ''}> Approve</label>
        <label><input type="checkbox" id="aad-chk-skip"    ${config.autoSkip ? 'checked' : ''}> Skip timers</label>
        <label><input type="checkbox" id="aad-chk-savelog" ${config.saveLog ? 'checked' : ''}> 💾 Log</label>
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

  const tab = document.createElement('div') as HTMLDivElement;
  tab.id = 'aad-tab';
  tab.className = 'shifted';
  tab.textContent = '◀ AAD';
  tab.title = 'Toggle Auto-Approve Deploy panel';
  document.body.appendChild(tab);

  const el: UIElements = {
    panel,
    tab,
    $info: document.getElementById('aad-info')!,
    $toggleBtn: document.getElementById('aad-toggle-btn') as HTMLButtonElement,
    $intervalIn: document.getElementById('aad-interval-input') as HTMLInputElement,
    $chkApprove: document.getElementById('aad-chk-approve') as HTMLInputElement,
    $chkSkip: document.getElementById('aad-chk-skip') as HTMLInputElement,
    $chkSaveLog: document.getElementById('aad-chk-savelog') as HTMLInputElement,
    $dlLogBtn: document.getElementById('aad-dl-log-btn') as HTMLButtonElement,
    $logPath: document.getElementById('aad-log-path')!,
    $statusText: document.getElementById('aad-status-text')!,
    $sessionCnt: document.getElementById('aad-session-cnt')!,
    $totalCnt: document.getElementById('aad-total-cnt')!,
    $log: document.getElementById('aad-log')!,
    $summary: document.getElementById('aad-summary')!,
    $tokenBtn: document.getElementById('aad-token-btn') as HTMLButtonElement,
  };

  if (config.saveLog) el.$logPath.style.display = 'block';

  // Restore panel visibility from config
  if (!config.panelVisible) {
    panel.classList.add('collapsed');
    tab.classList.remove('shifted');
    tab.textContent = '◀ AAD';
  }

  // Collapse / Expand
  function togglePanel(): void {
    const isCollapsed = panel.classList.toggle('collapsed');
    tab.classList.toggle('shifted', !isCollapsed);
    tab.textContent = isCollapsed ? '◀ AAD' : '▶';
    config.panelVisible = !isCollapsed;
    saveConfigField('panelVisible', config.panelVisible);
  }
  tab.addEventListener('click', togglePanel);
  document.getElementById('aad-collapse-btn')!.addEventListener('click', togglePanel);

  return el;
}

export function renderRunInfo(el: UIElements, run: { name: string; status: string; conclusion: string | null; head_branch: string }, owner: string, repo: string): void {
  const badgeClass =
    run.status === 'completed'
      ? run.conclusion === 'success'
        ? 'aad-badge-completed'
        : 'aad-badge-failure'
      : run.status === 'in_progress'
        ? 'aad-badge-in_progress'
        : 'aad-badge-queued';

  el.$info.innerHTML = `
    <strong>${esc(owner)}/${esc(repo)}</strong><br>
    <span class="aad-run-name">${esc(run.name)}</span> · ${esc(run.head_branch)}<br>
    Status: <span class="aad-status-badge ${badgeClass}">${esc(run.status)}${run.conclusion ? ' · ' + esc(run.conclusion) : ''}</span>
  `;
}

export function renderToggle(el: UIElements, running: boolean): void {
  if (running) {
    el.$toggleBtn.textContent = '⏹ Stop';
    el.$toggleBtn.className = 'stop';
    setControlsEnabled(el, false);
  } else {
    el.$toggleBtn.textContent = '▶ Start';
    el.$toggleBtn.className = 'start';
    setControlsEnabled(el, true);
  }
}

export function renderCounters(el: UIElements, state: State): void {
  el.$sessionCnt.textContent = String(state.sessionApproved);
  el.$totalCnt.textContent = String(state.totalApproved);
}

export function setStatus(el: UIElements, html: string): void {
  el.$statusText.innerHTML = html;
}

export function addLog(el: UIElements, msg: string, level = 'info'): void {
  const tag = '[AAD]';
  const consoleFn =
    level === 'err' ? console.error :
    level === 'warn' ? console.warn :
    level === 'ok' ? console.info : console.log;
  consoleFn(`${tag} ${msg}`);

  const timeStr = ts();
  appendLogToStore(`[${timeStr}] [${level}] ${msg}`);

  const entry = document.createElement('div');
  entry.className = 'aad-log-entry';
  entry.innerHTML = `<span class="aad-log-time">${timeStr}</span> <span class="aad-log-${level}">${esc(msg)}</span>`;
  el.$log.appendChild(entry);
  el.$log.scrollTop = el.$log.scrollHeight;

  while (el.$log.children.length > 200) {
    el.$log.removeChild(el.$log.firstChild!);
  }
}

export function restoreLogsToPanel(el: UIElements): void {
  const lines = getStoredLogs();
  if (lines.length === 0) return;
  const maxRestore = 50;
  const recent = lines.slice(-maxRestore);

  const sep = document.createElement('div');
  sep.className = 'aad-log-entry';
  sep.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 以下为刷新前日志 (最近 ${recent.length}/${lines.length} 条) ──</span>`;
  el.$log.appendChild(sep);

  recent.forEach((line) => {
    const m = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    const entry = document.createElement('div');
    entry.className = 'aad-log-entry';
    if (m) {
      entry.innerHTML = `<span class="aad-log-time">${esc(m[1])}</span> <span class="aad-log-${m[2]}">${esc(m[3])}</span>`;
    } else {
      entry.innerHTML = `<span class="aad-log-info">${esc(line)}</span>`;
    }
    el.$log.appendChild(entry);
  });

  const sep2 = document.createElement('div');
  sep2.className = 'aad-log-entry';
  sep2.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 当前会话开始 ──</span>`;
  el.$log.appendChild(sep2);
  el.$log.scrollTop = el.$log.scrollHeight;
}

export function generateSummary(el: UIElements, state: State, config: Config, conclusion: string): void {
  const duration = Date.now() - state.monitorStartedAt;

  const timelineHtml = state.sessionEvents.map((ev) => {
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

  el.$summary.innerHTML = `
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
    ` : ''}
  `;
  el.$summary.style.display = 'block';
}

function setControlsEnabled(el: UIElements, enabled: boolean): void {
  const checkboxes = [el.$chkApprove, el.$chkSkip, el.$chkSaveLog];
  checkboxes.forEach((cb) => {
    cb.disabled = !enabled;
    const label = cb.closest('label');
    if (label) label.classList.toggle('aad-disabled', !enabled);
  });
  el.$intervalIn.disabled = !enabled;
  const wrap = el.$intervalIn.closest('#aad-interval-wrap');
  if (wrap) wrap.classList.toggle('aad-disabled', !enabled);
  [el.$tokenBtn, el.$dlLogBtn].forEach((btn) => {
    btn.disabled = !enabled;
    btn.classList.toggle('aad-disabled', !enabled);
  });
}
