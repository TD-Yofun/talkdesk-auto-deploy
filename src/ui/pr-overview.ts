/** Pull request section inserted into the GitHub home sidebar. */
import {
  getMyPullRequests,
  getPullRequestSearchUrls,
  type PullRequest,
  type PullRequestGroups,
} from '../core/pull-requests';
import { esc } from '../utils/helpers';

const WIDGET_ID = 'aad-pr-sidebar';

type PullRequestState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ready'; data: PullRequestGroups }
  | { kind: 'error'; message: string };

let state: PullRequestState = { kind: 'idle' };
let request: Promise<void> | null = null;
let sidebarObserver: MutationObserver | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

function getHost(): HTMLElement | null {
  const existing = document.getElementById(WIDGET_ID) as HTMLElement | null;
  if (existing) return existing;

  const details = document.querySelector<HTMLElement>(
    '.dashboard-sidebar loading-context [data-target="loading-context.details"]'
  );
  if (!details) return null;

  const host = document.createElement('section');
  host.id = WIDGET_ID;
  const content = details.querySelector<HTMLElement>(':scope > .tmp-px-4') || details;
  content.append(host);
  return host;
}

function renderPullRequestItems(pullRequests: PullRequest[]): string {
  if (pullRequests.length === 0) return '<div class="aad-pr-empty">No open pull requests</div>';
  return pullRequests.slice(0, 5).map((pullRequest) => `<div class="aad-pr-item">
    <a href="${esc(pullRequest.url)}" target="_blank" rel="noopener" class="aad-pr-link">${esc(pullRequest.title)}</a>
    <span class="aad-pr-meta">${esc(pullRequest.owner)}/${esc(pullRequest.repo)} · #${esc(pullRequest.number)}</span>
  </div>`).join('');
}

function renderContent(): string {
  if (state.kind === 'ready') {
    const { authored, reviewedByMe } = state.data;
    const urls = getPullRequestSearchUrls();
    return `<div class="aad-pr-group">
      <div class="aad-pr-group-title"><span>Opened by me</span><span>${authored.length}</span></div>
      ${renderPullRequestItems(authored)}
      <a href="${urls.authored}" target="_blank" rel="noopener" class="aad-pr-all">View all opened PRs</a>
    </div>
    <div class="aad-pr-group">
      <div class="aad-pr-group-title"><span>Reviewed by me</span><span>${reviewedByMe.length}</span></div>
      ${renderPullRequestItems(reviewedByMe)}
      <a href="${urls.reviewedByMe}" target="_blank" rel="noopener" class="aad-pr-all">View all reviewed PRs</a>
    </div>`;
  }
  if (state.kind === 'error') return `<div class="aad-pr-empty aad-pr-error">${esc(state.message)}</div>`;
  return '<div class="aad-pr-empty">Loading pull requests...</div>';
}

function renderWidget(): boolean {
  const host = getHost();
  if (!host) return false;
  host.innerHTML = `<div class="aad-pr-header">
    <span>My pull requests</span>
    <button class="aad-pr-refresh" title="Refresh pull requests" ${state.kind === 'loading' ? 'disabled' : ''}>↻</button>
  </div>
  <div class="aad-pr-body">${renderContent()}</div>`;
  host.querySelector('.aad-pr-refresh')?.addEventListener('click', () => {
    void loadPullRequests();
  });
  return true;
}

function reconcileSidebar(): void {
  reconcileTimer = null;
  if (location.pathname !== '/') return;
  if (renderWidget() && state.kind === 'idle') void loadPullRequests();
}

function observeSidebar(): void {
  if (sidebarObserver) return;
  sidebarObserver = new MutationObserver(() => {
    if (document.getElementById(WIDGET_ID) || reconcileTimer) return;
    reconcileTimer = setTimeout(reconcileSidebar, 50);
  });
  sidebarObserver.observe(document.body, { childList: true, subtree: true });
}

async function loadPullRequests(): Promise<void> {
  if (request) return request;
  state = { kind: 'loading' };
  renderWidget();
  request = getMyPullRequests().then((data) => {
    state = { kind: 'ready', data };
  }).catch((error) => {
    state = { kind: 'error', message: (error as Error).message || 'Unable to load pull requests' };
  }).finally(() => {
    request = null;
    if (location.pathname === '/') renderWidget();
  });
  return request;
}

/** Mount on GitHub home only. It fetches once per home-page visit. */
export function mountPullRequestWidget(isOnHomePage: boolean): void {
  if (!isOnHomePage) {
    document.getElementById(WIDGET_ID)?.remove();
    sidebarObserver?.disconnect();
    sidebarObserver = null;
    if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
    state = { kind: 'idle' };
    return;
  }
  observeSidebar();
  if (renderWidget() && state.kind === 'idle') void loadPullRequests();
  else reconcileSidebar();
}
