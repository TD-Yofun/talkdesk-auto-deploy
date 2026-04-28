/**
 * URL parsing — extract owner/repo/run_id from GitHub Actions page URL
 */
export interface RunParams {
  owner: string;
  repo: string;
  runId: string;
}

export function parseUrl(): RunParams | null {
  const urlMatch = location.pathname.match(
    /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/
  );
  if (!urlMatch) return null;
  const [, owner, repo, runId] = urlMatch;
  return { owner, repo, runId };
}
