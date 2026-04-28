/**
 * Log persistence — batch buffer with debounced flush to GM storage
 */

let _logBuffer: string[] = [];
let _logFlushTimer: ReturnType<typeof setTimeout> | null = null;
let _saveLog = false;
let _logStoreKey = '';

export function initLogStore(runId: string, saveLog: boolean): void {
  _logStoreKey = `aad_log_${runId}`;
  _saveLog = saveLog;
}

export function setLogSaving(enabled: boolean): void {
  _saveLog = enabled;
}

function _flushLogBuffer(): void {
  if (_logBuffer.length === 0) return;
  const arr = GM_getValue<string[] | string>(_logStoreKey, []);
  const existing: string[] = typeof arr === 'string'
    ? (arr ? arr.split('\n').filter(Boolean) : [])
    : arr;
  existing.push(..._logBuffer);
  if (existing.length > 2000) existing.splice(0, existing.length - 2000);
  GM_setValue(_logStoreKey, existing);
  _logBuffer = [];
}

export function appendLogToStore(line: string): void {
  if (!_saveLog) return;
  _logBuffer.push(line);
  if (_logBuffer.length >= 20) {
    _flushLogBuffer();
  } else {
    if (_logFlushTimer) clearTimeout(_logFlushTimer);
    _logFlushTimer = setTimeout(_flushLogBuffer, 500);
  }
}

export function getStoredLogs(): string[] {
  _flushLogBuffer();
  const data = GM_getValue<string[] | string>(_logStoreKey, []);
  if (typeof data === 'string') {
    return data ? data.split('\n').filter(Boolean) : [];
  }
  return data;
}

export function downloadLog(runId: string): void {
  const lines = getStoredLogs();
  if (lines.length === 0) {
    alert('当前 Run 暂无日志记录');
    return;
  }
  const content = lines.join('\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aad-run-${runId}.log`;
  a.click();
  URL.revokeObjectURL(url);
}
