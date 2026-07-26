/** Floating overview for active monitored runs on non-run GitHub pages. */
import { esc, formatDuration } from '../utils/helpers';

const STALE_MS = 30 * 60 * 1000;
const WIDGET_ID = 'aad-overview';

interface ActiveRun {
  runId: string;
  startedAt: number;
  url?: string;
  approved?: number;
  owner?: string;
  repo?: string;
  workflow?: string;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let dismissed = false;
let lastPath = '';

function listActiveRuns(): ActiveRun[] {
  if (typeof GM_listValues !== 'function') return [];
  const now = Date.now();
  const runs: ActiveRun[] = [];
  for (const key of GM_listValues()) {
    if (!key.startsWith('aad_running_')) continue;
    const ts = GM_getValue<number>(key, 0);
    if (!ts || now - ts > STALE_MS) continue;
    const runId = key.slice('aad_running_'.length);
    const session = GM_getValue<any>(`aad_session_${runId}`, null);
    const meta = GM_getValue<any>(`aad_meta_${runId}`, null);
    runs.push({
      runId,
      startedAt: session?.startedAt || ts,
      approved: session?.approved || 0,
      url: meta?.url,
      owner: meta?.owner,
      repo: meta?.repo,
      workflow: meta?.workflow,
    });
  }
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

/** Persist minimal metadata for a run so the overview widget can render links. */
export function saveRunMeta(runId: string, meta: { owner: string; repo: string; workflow: string }): void {
  GM_setValue(`aad_meta_${runId}`, {
    ...meta,
    url: `https://github.com/${meta.owner}/${meta.repo}/actions/runs/${runId}`,
  });
}

function renderWidget(runs: ActiveRun[]): void {
  let widget = document.getElementById(WIDGET_ID);
  if (runs.length === 0 || dismissed) {
    widget?.remove();
    return;
  }
  if (!widget) {
    widget = document.createElement('aside');
    widget.id = WIDGET_ID;
    document.body.appendChild(widget);
  }
  widget.classList.toggle('aad-ov-home', location.pathname === '/');

  const now = Date.now();
  const items = runs.map((run) => {
    const label = run.workflow && run.owner && run.repo
      ? `${esc(run.owner)}/${esc(run.repo)} · ${esc(run.workflow)} #${esc(run.runId)}`
      : `Run #${esc(run.runId)}`;
    return `<div class="aad-ov-item">
      <a href="${esc(run.url || '#')}" class="aad-ov-link">${label}</a>
      <span class="aad-ov-meta">${formatDuration(now - run.startedAt)} · ${run.approved || 0} approvals</span>
    </div>`;
  }).join('');

  widget.innerHTML = `<div class="aad-ov-header">
    <span>AAD · ${runs.length} active</span>
    <button class="aad-ov-close" title="Hide active runs">×</button>
  </div>
  <div class="aad-ov-body">${items}</div>`;
  widget.querySelector('.aad-ov-close')?.addEventListener('click', () => {
    dismissed = true;
    widget?.remove();
  });
}

/** Mount/refresh the active runs overview. Safe to call repeatedly. */
export function mountOverviewWidget(isOnRunPage: boolean): void {
  if (isOnRunPage) {
    document.getElementById(WIDGET_ID)?.remove();
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    return;
  }
  if (lastPath !== location.pathname) {
    dismissed = false;
    lastPath = location.pathname;
  }
  const tick = () => renderWidget(listActiveRuns());
  tick();
  if (!refreshTimer) refreshTimer = setInterval(tick, 5000);
}

/** Remove meta for a run id (called when monitoring is fully stopped). */
export function clearRunMeta(runId: string): void {
  if (typeof GM_deleteValue === 'function') GM_deleteValue(`aad_meta_${runId}`);
}
