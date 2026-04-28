# Project Guidelines

## Overview

Tampermonkey userscript (`auto-approve-deploy.user.js`) that auto-approves GitHub Actions deployment gates and skips wait timers via DOM interaction.

## Code Style

- Single-file IIFE structure with section separators (`// ═══...`)
- Vanilla JS (no build tools, no modules, no TypeScript)
- Tampermonkey GM_* APIs for cross-origin requests (`GM_xmlhttpRequest`), persistent storage (`GM_getValue`/`GM_setValue`), and CSS injection (`GM_addStyle`)
- Template literals for HTML/CSS generation; `esc()` helper for XSS prevention
- Async/await for API calls and DOM timing; `setTimeout` for polling loops

## Architecture

```
auto-approve-deploy.user.js   ← Single-file userscript (all logic)
README.md                      ← User documentation (English)
README.zh-CN.md                ← User documentation (Chinese)
```

Key sections in the userscript (in order):
1. **URL Parsing** — Extract owner/repo/run_id from page URL
2. **Config & State** — `GM_getValue`/`GM_setValue` for persistence
3. **Log Persistence** — Batch buffer with debounced flush
4. **Session Persistence** — `saveSession()`/`loadSession()` for cross-refresh state
5. **Helpers** — `ts()`, `esc()`, `recordEvent()`, `formatDuration()`
6. **API Layer** — `GM_xmlhttpRequest` wrapper + REST endpoints
7. **Skip Wait Timers** — DOM-based, 3 sequential approaches
8. **Poll Loop** — Status check → approve → skip → timer display
9. **Start/Resume/Stop** — Lifecycle management
10. **Styles & UI** — Side panel with controls, log, summary report

## Conventions

- **No page refresh after API-only operations** — `softRefresh()` only for DOM-dependent actions (skip timers)
- **Session persistence** — All counters (`sessionApproved`, `sessionSkipped`, `pollCycle`, `lastSkipKey`, `sessionEvents`) persist via `aad_session_{RUN_ID}` key
- **`start()` vs `resume()`** — `start()` resets state (fresh), `resume()` restores from session (after page refresh)
- **`lastSkipKey`** — Prevents redundant skip attempts on the same environment after reload
- **Log entries** format: `[HH:MM:SS] [level] message` where level is `info`/`ok`/`warn`/`err`
- **Event timeline** — `recordEvent(type, detail)` for summary report; types: `start`, `resume`, `approve`, `skip`, `complete`, `error`
- Prefer quick re-poll (5s) after successful approve instead of full interval wait

## Security

- GitHub token stored in Tampermonkey secure storage (`GM_getValue`), never exposed to page scripts
- DOM output always escaped via `esc()` helper to prevent XSS
- CSRF tokens extracted from page DOM for skip form submissions (same-origin `fetch` with `credentials: 'same-origin'`)
