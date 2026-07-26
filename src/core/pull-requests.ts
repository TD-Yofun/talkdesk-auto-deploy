/**
 * Pull request discovery through GitHub's authenticated HTML pages.
 * This avoids REST API rate limits and reuses the browser's GitHub session.
 */
export interface PullRequest {
  owner: string;
  repo: string;
  number: string;
  title: string;
  url: string;
}

export interface PullRequestGroups {
  authored: PullRequest[];
  reviewedByMe: PullRequest[];
}

export interface PullRequestSearchUrls {
  authored: string;
  reviewedByMe: string;
}

export function getPullRequestSearchUrls(): PullRequestSearchUrls {
  const login = document.querySelector('meta[name="user-login"]')?.getAttribute('content')?.trim() || '@me';
  return {
    authored: `/pulls/search?q=${encodeURIComponent(`is:pr is:open author:${login}`)}`,
    reviewedByMe: `/pulls/search?q=${encodeURIComponent(`is:pr is:open reviewed-by:${login}`)}`,
  };
}

export async function getMyPullRequests(): Promise<PullRequestGroups> {
  const urls = getPullRequestSearchUrls();
  const [authored, reviewedByMe] = await Promise.all([
    fetchPullRequests(urls.authored),
    fetchPullRequests(urls.reviewedByMe),
  ]);
  return { authored, reviewedByMe };
}

async function fetchPullRequests(path: string): Promise<PullRequest[]> {
  const documents = await fetchPullRequestDocuments(path);
  return mergePullRequests(documents.flatMap(parsePullRequests));
}

async function fetchPullRequestDocuments(path: string, depth = 0): Promise<Document[]> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  if (new URL(response.url).pathname === '/login') throw new Error('GitHub login is required');

  const document = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (depth >= 2 || parsePullRequests(document).length > 0) return [document];

  // GitHub's dashboard can defer results into include-fragment elements. Fetch
  // the relevant fragments so DOM parsing sees the same PR links as the page.
  const fragments = [...document.querySelectorAll<HTMLElement>('include-fragment[src]')]
    .map((fragment) => new URL(fragment.getAttribute('src') || '', location.origin))
    .filter((url) => /pull|issue|dashboard/.test(url.pathname));
  const nested = await Promise.allSettled(fragments.slice(0, 6).map((url) => fetchPullRequestDocuments(url.href, depth + 1)));
  return [document, ...nested.flatMap((result) => result.status === 'fulfilled' ? result.value : [])];
}

function parsePullRequests(document: Document): PullRequest[] {
  const seen = new Set<string>();
  const pullRequests: PullRequest[] = [];

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"]')) {
    const url = new URL(link.href, location.origin);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!match || seen.has(url.pathname)) continue;

    const title = (link.textContent || '').trim().replace(/\s+/g, ' ');
    if (!title) continue;
    seen.add(url.pathname);
    const [, owner, repo, number] = match;
    pullRequests.push({ owner, repo, number, title, url: url.href });
  }

  return pullRequests;
}

function mergePullRequests(pullRequests: PullRequest[]): PullRequest[] {
  const seen = new Set<string>();
  return pullRequests.filter((pullRequest) => {
    if (seen.has(pullRequest.url)) return false;
    seen.add(pullRequest.url);
    return true;
  });
}
