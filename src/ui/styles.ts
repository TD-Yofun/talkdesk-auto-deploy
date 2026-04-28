/**
 * Styles — injected via GM_addStyle
 */
export function injectStyles(): void {
  GM_addStyle(`
    /* ── Side Panel ───────────────────────────────────────── */
    #aad-panel {
      position: fixed !important;
      top: 0; right: 0;
      width: 360px;
      height: 100vh;
      background: #161b22;
      border-left: 1px solid #30363d;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 2147483647 !important;
      box-shadow: -4px 0 16px rgba(0,0,0,.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: transform .3s cubic-bezier(.4,0,.2,1);
    }
    #aad-panel.collapsed { transform: translateX(100%); }

    /* ── Collapse Tab ─────────────────────────────────────── */
    #aad-tab {
      position: fixed !important;
      top: 50%; right: 0;
      transform: translateY(-50%);
      z-index: 2147483647 !important;
      background: #0d1117;
      border: 1px solid #30363d;
      border-right: none;
      border-radius: 8px 0 0 8px;
      padding: 10px 5px;
      cursor: pointer;
      color: #8b949e;
      font-size: 11px;
      font-weight: 600;
      writing-mode: vertical-rl;
      letter-spacing: 1px;
      user-select: none;
      transition: right .3s cubic-bezier(.4,0,.2,1), background .15s;
    }
    #aad-tab:hover { background: #161b22; color: #e6edf3; }
    #aad-tab.shifted { right: 360px; }

    /* ── Header ───────────────────────────────────────────── */
    #aad-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      flex-shrink: 0;
      user-select: none;
    }
    #aad-header .aad-title {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #aad-header .aad-btns { display: flex; gap: 4px; }
    #aad-header .aad-btns button {
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    #aad-header .aad-btns button:hover { color: #e6edf3; background: #30363d; }

    /* ── Body ─────────────────────────────────────────────── */
    #aad-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex: 1;
      min-height: 0;
    }

    /* ── Info ─────────────────────────────────────────────── */
    #aad-info {
      padding: 10px 14px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
      color: #8b949e;
      line-height: 1.6;
      flex-shrink: 0;
    }
    #aad-info strong { color: #e6edf3; font-weight: 500; }
    #aad-info .aad-run-name { color: #58a6ff; }
    #aad-info .aad-status-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }
    .aad-badge-queued      { background: #d29922; color: #0d1117; }
    .aad-badge-in_progress { background: #58a6ff; color: #0d1117; }
    .aad-badge-waiting     { background: #d29922; color: #0d1117; }
    .aad-badge-completed   { background: #3fb950; color: #0d1117; }
    .aad-badge-failure     { background: #f85149; color: #0d1117; }

    /* ── Controls ─────────────────────────────────────────── */
    #aad-controls {
      padding: 10px 14px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #21262d;
      flex-shrink: 0;
    }
    #aad-toggle-btn {
      padding: 5px 16px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      transition: background .15s;
    }
    #aad-toggle-btn.start { background: #238636; }
    #aad-toggle-btn.start:hover { background: #2ea043; }
    #aad-toggle-btn.stop  { background: #da3633; }
    #aad-toggle-btn.stop:hover  { background: #f85149; }
    #aad-controls label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8b949e;
      cursor: pointer;
    }
    #aad-controls label:hover { color: #e6edf3; }
    #aad-controls input[type="checkbox"] { accent-color: #238636; }
    #aad-interval-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8b949e;
    }
    #aad-interval-input {
      width: 40px;
      padding: 2px 4px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 4px;
      color: #e6edf3;
      font-size: 12px;
      text-align: center;
    }
    #aad-token-btn, #aad-dl-log-btn {
      background: none;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 8px;
    }
    #aad-token-btn:hover, #aad-dl-log-btn:hover { color: #e6edf3; border-color: #8b949e; }
    #aad-controls .aad-disabled { opacity: 0.4; pointer-events: none; }

    /* ── Status Bar ───────────────────────────────────────── */
    #aad-status-bar {
      padding: 8px 14px;
      font-size: 12px;
      color: #8b949e;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #aad-status-bar .aad-counters strong { color: #3fb950; }

    /* ── Log Path ─────────────────────────────────────────── */
    #aad-log-path {
      padding: 4px 14px;
      font-size: 11px;
      color: #58a6ff;
      border-bottom: 1px solid #21262d;
      display: none;
      flex-shrink: 0;
    }

    /* ── Summary Report ───────────────────────────────────── */
    #aad-summary {
      padding: 12px 14px;
      border-bottom: 1px solid #21262d;
      display: none;
      flex-shrink: 0;
      max-height: 40vh;
      overflow-y: auto;
    }
    .aad-summary-header {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      color: #e6edf3;
    }
    .aad-summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 16px;
    }
    .aad-summary-item {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .aad-summary-label { color: #8b949e; }
    .aad-timeline {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      line-height: 1.6;
    }
    .aad-timeline-item { color: #8b949e; }

    /* ── Log ──────────────────────────────────────────────── */
    #aad-log {
      flex: 1;
      overflow-y: auto;
      padding: 8px 14px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      min-height: 0;
    }
    #aad-log::-webkit-scrollbar { width: 6px; }
    #aad-log::-webkit-scrollbar-track { background: transparent; }
    #aad-log::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .aad-log-entry { white-space: pre-wrap; word-break: break-word; }
    .aad-log-time  { color: #484f58; }
    .aad-log-info  { color: #8b949e; }
    .aad-log-ok    { color: #3fb950; }
    .aad-log-warn  { color: #d29922; }
    .aad-log-err   { color: #f85149; }
  `);
}
