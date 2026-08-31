/** Discover organizations and repositories through GitHub's authenticated HTML pages. */
export interface Organization {
  login: string;
  name: string;
  url: string;
}

export interface OrganizationRepository {
  owner: string;
  name: string;
  fullName: string;
  description: string;
  url: string;
}

async function fetchDocument(path: string): Promise<Document> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  if (new URL(response.url).pathname === '/login') throw new Error('GitHub login is required');
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

async function fetchDocuments(path: string, depth = 0): Promise<Document[]> {
  const document = await fetchDocument(path);
  if (depth >= 2) return [document];

  const fragments = [...document.querySelectorAll<HTMLElement>('include-fragment[src], turbo-frame[src]')]
    .map((fragment) => new URL(fragment.getAttribute('src') || '', location.origin))
    .filter((url) => url.origin === location.origin && /org|organization|setting/i.test(url.pathname));
  const nested = await Promise.allSettled(
    fragments.slice(0, 8).map((url) => fetchDocuments(url.href, depth + 1)),
  );
  return [document, ...nested.flatMap((result) => result.status === 'fulfilled' ? result.value : [])];
}

export async function getMyOrganizations(): Promise<Organization[]> {
  const dashboardOrganizations = collectDashboardOrganizations(document);
  if (dashboardOrganizations.length > 0) return dashboardOrganizations;

  const documents = await fetchDocuments('/settings/organizations');
  const organizations = collectOrganizations(documents);
  if (organizations.length > 0) return organizations;

  // GitHub has served the same membership list from both settings and the
  // user organizations page over time. Keep the fallback session-only.
  try {
    return collectOrganizations(await fetchDocuments('/user/orgs'));
  } catch {
    return organizations;
  }
}

function collectDashboardOrganizations(document: Document): Organization[] {
  const organizations: Organization[] = [];
  const seen = new Set<string>();
  const links = document.querySelectorAll<HTMLAnchorElement>(
    'dialog[id^="switch_dashboard_context"] a[role="option"][href], dialog[id^="switch_dashboard_context"] a[href^="/orgs/"]',
  );

  for (const link of links) {
    const url = new URL(link.href, location.origin);
    const match = url.pathname.match(/^\/orgs\/([^/]+)(?:\/|$)/i);
    if (!match) continue;

    const login = decodeURIComponent(match[1]);
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const label = (link.querySelector('.ActionListItem-label')?.textContent || link.textContent || '')
      .trim().replace(/\s+/g, ' ');
    organizations.push({
      login,
      name: label || login,
      url: `https://github.com/orgs/${encodeURIComponent(login)}`,
    });
  }

  return organizations.sort((a, b) => a.name.localeCompare(b.name));
}

function collectOrganizations(documents: Document[]): Organization[] {
  const organizations: Organization[] = [];
  const logins = new Map<string, string>();
  const names = new Map<string, string>();

  for (const document of documents) {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const url = new URL(link.href, location.origin);
      const match = url.pathname.match(/^\/orgs\/([^/]+)(?:\/|$)/i);
      if (!match) continue;

      const login = decodeURIComponent(match[1]);
      const key = login.toLowerCase();
      const label = (link.textContent || '').trim().replace(/\s+/g, ' ');
      const isRootLink = /^\/orgs\/[^/]+\/?$/i.test(url.pathname);
      if (!logins.has(key)) logins.set(key, login);
      if (label && (!names.has(key) || isRootLink)) names.set(key, label);
    }
  }

  for (const [key, login] of logins) {
    organizations.push({
      login,
      name: names.get(key) || login,
      url: `https://github.com/orgs/${encodeURIComponent(login)}`,
    });
  }
  return organizations.sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchOrganizationRepositories(
  organization: string,
  keyword: string,
): Promise<OrganizationRepository[]> {
  const query = `org:${organization} ${keyword.trim()}`.trim();
  const path = `/search?q=${encodeURIComponent(query)}&type=repositories`;
  const document = await fetchDocument(path);
  const repositories: OrganizationRepository[] = [];
  const seen = new Set<string>();

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = new URL(link.href, location.origin);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match || match[1].toLowerCase() !== organization.toLowerCase()) continue;

    const repo = decodeURIComponent(match[2]);
    const fullName = `${match[1]}/${repo}`;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const resultItem = link.closest<HTMLElement>('li, [data-testid="results-list"] > div, .Box-row');
    const description = (resultItem?.querySelector('p')?.textContent || '').trim().replace(/\s+/g, ' ');
    repositories.push({
      owner: match[1],
      name: repo,
      fullName,
      description,
      url: `https://github.com/${encodeURIComponent(match[1])}/${encodeURIComponent(repo)}`,
    });
  }

  return repositories;
}
