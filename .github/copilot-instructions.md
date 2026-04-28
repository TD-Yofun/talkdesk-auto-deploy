# Project Guidelines

## Overview

Tampermonkey userscript that auto-approves GitHub Actions deployment gates and skips wait timers via DOM interaction. Built with Vite + TypeScript, outputs `auto-approve-deploy.user.js` as the bundled userscript.

## Code Style

- TypeScript with strict mode, modular `src/` structure
- Vite + `vite-plugin-monkey` for building and userscript header generation
- Tampermonkey GM_* APIs for cross-origin requests (`GM_xmlhttpRequest`), persistent storage (`GM_getValue`/`GM_setValue`), and CSS injection (`GM_addStyle`)
- Template literals for HTML/CSS generation; `esc()` helper for XSS prevention
- Async/await for API calls and DOM timing; `setTimeout` for polling loops

## Architecture

```
src/
  main.ts              ← Entry point, wires all modules
  core/
    config.ts          ← Persistent config (GM_getValue/GM_setValue)
    state.ts           ← Runtime state types & factory
    log-store.ts       ← Log persistence (batch buffer, debounced flush)
    session.ts         ← Session persistence (save/load/clear across refreshes)
  api/
    api.ts             ← GitHub REST API layer (GM_xmlhttpRequest)
    skip-timers.ts     ← DOM-based skip wait timers (3 approaches)
  ui/
    styles.ts          ← CSS injection via GM_addStyle
    ui.ts              ← Panel build, render, event binding
  utils/
    helpers.ts         ← ts(), esc(), formatDuration()
    url.ts             ← URL parsing (owner/repo/runId)
auto-approve-deploy.user.js      ← Build output, dev (do not edit)
auto-approve-deploy.min.user.js  ← Build output, minified (do not edit)
vite.config.ts       ← Vite + vite-plugin-monkey config
README.md            ← User documentation (English)
README.zh-CN.md      ← User documentation (Chinese)
```

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
