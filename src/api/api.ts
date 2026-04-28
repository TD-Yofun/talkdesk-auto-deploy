/**
 * GitHub REST API layer (cross-origin via GM_xmlhttpRequest)
 */

const API = 'https://api.github.com';

export function api<T = unknown>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error('No GitHub token configured'));
    GM_xmlhttpRequest({
      method: method as 'GET' | 'POST',
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
            resolve(r.responseText as T);
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

export interface RunInfo {
  name: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
}

export interface PendingDeployment {
  current_user_can_approve: boolean;
  wait_timer: number;
  wait_timer_started_at: string | null;
  environment: {
    id: number;
    name: string;
  };
}

export interface JobsData {
  jobs: Array<{
    name: string;
    conclusion: string | null;
  }>;
}

export function fetchRunInfo(owner: string, repo: string, runId: string, token: string): Promise<RunInfo> {
  return api('GET', `/repos/${owner}/${repo}/actions/runs/${runId}`, token);
}

export function fetchPending(owner: string, repo: string, runId: string, token: string): Promise<PendingDeployment[]> {
  return api('GET', `/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`, token);
}

export function approveDeployments(owner: string, repo: string, runId: string, token: string, envIds: number[]): Promise<unknown> {
  return api('POST', `/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`, token, {
    environment_ids: envIds,
    state: 'approved',
    comment: 'Auto-approved by Auto-Approve Deploy Gates',
  });
}

export function fetchJobs(owner: string, repo: string, runId: string, token: string): Promise<JobsData> {
  return api('GET', `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`, token);
}
