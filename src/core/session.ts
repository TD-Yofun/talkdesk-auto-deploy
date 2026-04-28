/**
 * Session persistence — save/load running state across page refreshes
 */
import type { State } from './state';

export function saveRunningState(runId: string, on: boolean): void {
  const stateKey = `aad_running_${runId}`;
  GM_setValue(stateKey, on ? Date.now() : 0);
}

export function wasRunning(runId: string): boolean {
  const stateKey = `aad_running_${runId}`;
  const savedTs = GM_getValue<number>(stateKey, 0);
  return savedTs > 0 && (Date.now() - savedTs) < 30 * 60 * 1000;
}

interface SessionData {
  approved: number;
  skipped: number;
  events: State['sessionEvents'];
  startedAt: number;
  pollCycle: number;
  lastSkipKey: string;
}

export function saveSession(runId: string, state: State): void {
  const sessionKey = `aad_session_${runId}`;
  GM_setValue(sessionKey, {
    approved: state.sessionApproved,
    skipped: state.sessionSkipped,
    events: state.sessionEvents,
    startedAt: state.monitorStartedAt,
    pollCycle: state.pollCycle,
    lastSkipKey: state.lastSkipKey,
  } satisfies SessionData);
}

export function loadSession(runId: string, state: State): boolean {
  const sessionKey = `aad_session_${runId}`;
  const s = GM_getValue<SessionData | null>(sessionKey, null);
  if (!s) return false;
  state.sessionApproved = s.approved || 0;
  state.sessionSkipped = s.skipped || 0;
  state.sessionEvents = s.events || [];
  state.monitorStartedAt = s.startedAt || Date.now();
  state.pollCycle = s.pollCycle || 0;
  state.lastSkipKey = s.lastSkipKey || '';
  return true;
}

export function clearSession(runId: string): void {
  const sessionKey = `aad_session_${runId}`;
  GM_setValue(sessionKey, null);
}
