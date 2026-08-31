/** Organization repository search section inserted into the GitHub home sidebar. */
import {
  getMyOrganizations,
  searchOrganizationRepositories,
  type Organization,
  type OrganizationRepository,
} from '../core/organization-repositories';
import { esc } from '../utils/helpers';

const WIDGET_ID = 'aad-org-repo-search';

type OrganizationState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; organizations: Organization[] }
  | { kind: 'error'; message: string };

type SearchState =
  | { kind: 'idle'; results: OrganizationRepository[] }
  | { kind: 'loading'; results: OrganizationRepository[] }
  | { kind: 'ready'; results: OrganizationRepository[] }
  | { kind: 'error'; results: OrganizationRepository[]; message: string };

let organizationState: OrganizationState = { kind: 'idle' };
let searchState: SearchState = { kind: 'idle', results: [] };
let selectedOrganization = '';
let lastKeyword = '';
let organizationRequest: Promise<void> | null = null;
let searchRequest: Promise<void> | null = null;
let searchGeneration = 0;
let sidebarObserver: MutationObserver | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

function getHost(): HTMLElement | null {
  const existing = document.getElementById(WIDGET_ID) as HTMLElement | null;
  if (existing) return existing;

  const details = document.querySelector<HTMLElement>(
    '.dashboard-sidebar loading-context [data-target="loading-context.details"]',
  );
  if (!details) return null;

  const host = document.createElement('section');
  host.id = WIDGET_ID;
  const content = details.querySelector<HTMLElement>(':scope > .tmp-px-4') || details;
  content.append(host);
  return host;
}

function renderOrganizations(): string {
  const current = organizationState;
  if (current.kind === 'loading' || current.kind === 'idle') {
    return '<option value="">Loading organizations...</option>';
  }
  if (current.kind === 'error') return '<option value="">Unable to load organizations</option>';
  if (current.organizations.length === 0) return '<option value="">No organizations found</option>';

  return `<option value="">Select an organization</option>${current.organizations.map((organization) =>
    `<option value="${esc(organization.login)}" ${organization.login === selectedOrganization ? 'selected' : ''}>${esc(organization.name)}</option>`
  ).join('')}`;
}

function renderResults(): string {
  if (searchState.kind === 'loading') return '<div class="aad-org-empty">Searching repositories...</div>';
  if (searchState.kind === 'error') return `<div class="aad-org-empty aad-org-error">${esc(searchState.message)}</div>`;
  if (organizationState.kind === 'ready' && organizationState.organizations.length === 0) {
    return '<div class="aad-org-empty">No organizations found</div>';
  }
  if (searchState.kind === 'idle') return '<div class="aad-org-empty">Search an organization\'s repositories</div>';
  if (searchState.results.length === 0) return '<div class="aad-org-empty">No repositories found</div>';

  return searchState.results.slice(0, 10).map((repository) => `<div class="aad-org-item">
    <a href="${esc(repository.url)}" target="_blank" rel="noopener" class="aad-org-link">${esc(repository.fullName)}</a>
    ${repository.description ? `<span class="aad-org-meta">${esc(repository.description)}</span>` : ''}
  </div>`).join('');
}

function renderWidget(): boolean {
  if (organizationState.kind === 'ready' && organizationState.organizations.length === 0) {
    document.getElementById(WIDGET_ID)?.remove();
    return true;
  }
  const host = getHost();
  if (!host) return false;

  const organizationData = organizationState.kind === 'ready' ? organizationState.organizations : [];
  const canSearch = organizationData.length > 0;
  const singleOrganization = organizationData.length === 1
    ? organizationData[0]
    : null;
  const busy = organizationState.kind === 'loading' || searchState.kind === 'loading';
  host.innerHTML = `<div class="aad-org-header">
    <span>Organization repositories</span>
    <button class="aad-org-refresh" type="button" title="Refresh organizations" ${busy ? 'disabled' : ''}>↻</button>
  </div>
  <form class="aad-org-form">
    ${singleOrganization
      ? `<div class="aad-org-single" aria-label="Organization">${esc(singleOrganization.name)}</div>`
      : `<div class="aad-org-select-wrap"><select class="aad-org-select" aria-label="Organization" ${canSearch ? '' : 'disabled'}>${renderOrganizations()}</select></div>`}
    <div class="aad-org-query-row">
      <input class="aad-org-query" type="search" aria-label="Repository search" placeholder="Search repositories" value="${esc(lastKeyword)}" ${canSearch ? '' : 'disabled'}>
      <button class="aad-org-submit" type="submit" ${canSearch && !busy ? '' : 'disabled'}>Search</button>
    </div>
  </form>
  ${organizationState.kind === 'error' ? `<div class="aad-org-empty aad-org-error">${esc(organizationState.message)}</div>` : ''}
  <div class="aad-org-results">${renderResults()}</div>`;

  host.querySelector<HTMLSelectElement>('.aad-org-select')?.addEventListener('change', (event) => {
    selectedOrganization = (event.target as HTMLSelectElement).value;
    searchGeneration++;
    searchState = { kind: 'idle', results: [] };
    renderWidget();
  });
  host.querySelector<HTMLFormElement>('.aad-org-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const query = form.querySelector<HTMLInputElement>('.aad-org-query')?.value.trim() || '';
    if (!selectedOrganization || !query) {
      searchState = { kind: 'error', results: [], message: 'Select an organization and enter a search term' };
      renderWidget();
      return;
    }
    lastKeyword = query;
    void searchRepositories();
  });
  host.querySelector<HTMLButtonElement>('.aad-org-refresh')?.addEventListener('click', () => {
    void loadOrganizations(true);
  });
  return true;
}

function reconcileSidebar(): void {
  reconcileTimer = null;
  if (location.pathname !== '/') return;
  if (renderWidget() && organizationState.kind === 'idle') void loadOrganizations(false);
}

function observeSidebar(): void {
  if (sidebarObserver) return;
  sidebarObserver = new MutationObserver(() => {
    if (organizationState.kind === 'ready' && organizationState.organizations.length === 0
      && document.querySelector('dialog[id^="switch_dashboard_context"] a[href^="/orgs/"]')) {
      void loadOrganizations(true);
    }
    if (document.getElementById(WIDGET_ID) || reconcileTimer) return;
    reconcileTimer = setTimeout(reconcileSidebar, 50);
  });
  sidebarObserver.observe(document.body, { childList: true, subtree: true });
}

async function loadOrganizations(force: boolean): Promise<void> {
  if (organizationRequest) return organizationRequest;
  if (!force && organizationState.kind === 'ready') return;
  organizationState = { kind: 'loading' };
  searchGeneration++;
  searchState = { kind: 'idle', results: [] };
  renderWidget();
  organizationRequest = getMyOrganizations().then((organizations) => {
    organizationState = { kind: 'ready', organizations };
    if (!organizations.some((organization) => organization.login === selectedOrganization)) {
      selectedOrganization = organizations[0]?.login || '';
    }
  }).catch((error) => {
    organizationState = { kind: 'error', message: (error as Error).message || 'Unable to load organizations' };
  }).finally(() => {
    organizationRequest = null;
    if (location.pathname === '/') renderWidget();
  });
  return organizationRequest;
}

async function searchRepositories(): Promise<void> {
  if (searchRequest || !selectedOrganization || !lastKeyword) return;
  const generation = ++searchGeneration;
  const organization = selectedOrganization;
  const keyword = lastKeyword;
  searchState = { kind: 'loading', results: [] };
  renderWidget();
  searchRequest = searchOrganizationRepositories(organization, keyword).then((results) => {
    if (generation === searchGeneration) searchState = { kind: 'ready', results };
  }).catch((error) => {
    if (generation === searchGeneration) {
      searchState = { kind: 'error', results: [], message: (error as Error).message || 'Unable to search repositories' };
    }
  }).finally(() => {
    searchRequest = null;
    if (location.pathname === '/') renderWidget();
  });
  return searchRequest;
}

/** Mount on GitHub home only. Organization data loads once per home-page visit. */
export function mountOrganizationRepositorySearch(isOnHomePage: boolean): void {
  if (!isOnHomePage) {
    document.getElementById(WIDGET_ID)?.remove();
    sidebarObserver?.disconnect();
    sidebarObserver = null;
    if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
    organizationState = { kind: 'idle' };
    searchState = { kind: 'idle', results: [] };
    searchGeneration++;
    selectedOrganization = '';
    lastKeyword = '';
    return;
  }
  observeSidebar();
  if (renderWidget() && organizationState.kind === 'idle') void loadOrganizations(false);
  else reconcileSidebar();
}
