/**
 * Runtime state for the monitoring session
 */
export interface SessionEvent {
  ts: number;
  type: string;
  detail: string;
}

export interface State {
  running: boolean;
  pollTimer: ReturnType<typeof setTimeout> | null;
  sessionApproved: number;
  totalApproved: number;
  lastSkipKey: string;
  monitorStartedAt: number;
  pollCycle: number;
  sessionSkipped: number;
  sessionEvents: SessionEvent[];
}

export const GRACE_PERIOD = 90; // seconds to wait for re-run to propagate

export function createState(): State {
  return {
    running: false,
    pollTimer: null,
    sessionApproved: 0,
    totalApproved: 0,
    lastSkipKey: '',
    monitorStartedAt: 0,
    pollCycle: 0,
    sessionSkipped: 0,
    sessionEvents: [],
  };
}
