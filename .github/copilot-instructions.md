# Copilot Instructions

## Project Overview

Tampermonkey userscript that auto-approves GitHub Actions deployment gates on `Deploy (PRD)` workflow runs. It prefers **"Review deployments"**, checks every `gate_request[]`, then clicks **"Approve and deploy"**; **"Start all waiting jobs"** is the legacy fallback. Pure DOM-based — **no GitHub token**. Built with Vite + TypeScript + `vite-plugin-monkey`; outputs `build/auto-approve-deploy.user.js` (dev) and `build/auto-approve-deploy.min.user.js` (prod). The `build/` folder is gitignored — artifacts are produced by CI and uploaded to GitHub Releases.

## Architecture

```
src/
├── main.ts                      # Entry — wires modules, page detection, lifecycle, global error handlers
├── core/
│   ├── config.ts                # GM_getValue/setValue persistent config (interval, saveLog, panelVisible)
│   ├── state.ts                 # Runtime state types; exports WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000
│   ├── log-store.ts             # Always-on per-run log buffer with debounced GM_setValue flush
│   ├── session.ts               # SessionData (cross-refresh resume); keyed by runId
│   ├── scheduler.ts             # Web Worker-based scheduleTick/cancelTick (avoids background tab throttling)
│   ├── pull-requests.ts         # Signed-in GitHub HTML pull request discovery
│   └── version-check.ts         # Compare vs latest userscript release asset; cache result; block outdated
├── api/
│   └── skip-timers.ts           # MutationObserver + 3 click strategies for the gate button
├── ui/
│   ├── styles.ts                # Injects compiled Sass via GM_addStyle
│   ├── styles.scss              # Panel and sidebar Sass styles
│   ├── ui.ts                    # Panel HTML/render/event binding; summary report + Markdown export
│   └── pr-overview.ts           # GitHub home pull request section below Top repositories
└── utils/
    ├── helpers.ts               # ts(), esc(), formatDuration()
    └── url.ts                   # parseRunUrl() + isDeployPrdPage() (matches /Deploy\s*\(PRD\)/)
```

## Critical Conventions

### Tampermonkey grants (vite.config.ts)

```
GM_addStyle, GM_getValue, GM_setValue,
GM_notification, unsafeWindow
```

- `GM_notification` — desktop notification on terminal conclusion (click → focus tab)

### Storage keys (all keyed by `runId`)

| Key | Purpose |
|-----|---------|
| `aad_config` | Global config (interval, saveLog, panelVisible) |
| `aad_running_${runId}` | `true` while monitoring; used by `wasRunning()` for resume |
| `aad_session_${runId}` | SessionData (counters, timeline, `lastProgressAt`) |
| `aad_log_${runId}` | Persisted log buffer (always written; never gated) |
| `aad_version_check` | Cached latest release check |

### State fields (state.ts)

- `running: boolean` — main on/off
- `paused: boolean` — pause toggle; when true, observer detached and tick is a heartbeat only
- `lastProgressAt: number` — updated on every successful click/event; watchdog reloads page after `WATCHDOG_TIMEOUT_MS` of no progress
- `counters` + `timeline[]` — surfaced in summary report

### Activation conditions

`main.ts → checkPage()` runs on every navigation event:
1. URL must match `/{owner}/{repo}/actions/runs/{id}` → `parseRunUrl()`
2. Page header workflow label must match `/Deploy\s*\(PRD\)/i` → `isDeployPrdPage()` (substring/emoji-prefix tolerant)
3. If both → build/restore the panel; otherwise only the GitHub home pull request widget is considered

### Scheduler (scheduler.ts)

- Default: dedicated Web Worker via `Blob` URL with `self.onmessage` handling `{type:'start', ms}` / `{type:'stop'}`. Worker `setTimeout` is not throttled in background tabs.
- Fallback: `setTimeout` when Worker unavailable.
- Always use `scheduleTick(cb, ms)` / `cancelTick()` — never call `setTimeout` directly for the poll loop.

### Logs always persisted

`log-store.appendLogToStore()` is **not** gated by `_saveLog`. The `💾 Log` toggle only controls the hint text in the panel; logs are always written and always downloadable. **Do not re-add the gate.**

### Conclusion detection

`main.ts → readRunConclusion()`:
1. Primary: `.actions-workflow-runs-status svg[aria-label]` — aria-label text contains keywords (`succeeded`, `failed`, `cancelled`, `timed out`, `skipped`, `in progress`)
2. Fallback: scan for elements with `color-fg-success` / `color-fg-danger` / `color-fg-attention` classes
3. `isTerminalConclusion(c)` matches terminal states → triggers auto-stop + summary + notification

### Watchdog (10 min)

In `poll()`: if `now - state.lastProgressAt > WATCHDOG_TIMEOUT_MS` while running and not paused → reset `lastProgressAt` before persisting state, then `location.reload()`. Resume path (`wasRunning()`) re-arms everything without immediately re-triggering the watchdog.

### bfcache & error capture (main.ts)

```ts
window.addEventListener('pageshow', (e) => {
  if (e.persisted) setTimeout(checkPage, 200);
});
window.addEventListener('error', /* → log */);
window.addEventListener('unhandledrejection', /* → log */);
```

### Pause/Resume

- `pauseMonitoring()` → disconnect observer + `cancelTick()`, keep `state.running = true`, set `state.paused = true`, start heartbeat tick
- `resumeMonitoring()` → re-arm observer, reset `lastProgressAt = Date.now()`, clear `paused`, schedule next tick
- `bindPanelEvents()` wires `#aad-pause-btn`; `renderToggle(el, running, paused)` shows label correctly

### Pull request sidebar section (pr-overview.ts)

- Mounted only on `github.com/` below Top repositories
- Fetches authored and `reviewed-by` open PRs for the current `meta[name="user-login"]` account from GitHub's authenticated HTML search pages once per home-page visit, then only when the refresh button is clicked
- Uses `target="_blank"` links for direct PR navigation

### Cross-refresh resume

- `wasRunning(runId)` checks `aad_running_${runId}`
- On `checkPage()` for a Deploy (PRD) run, if running flag set → auto-resume `start()` after panel build
- Counters/timeline come from `aad_session_${runId}`; logs from `aad_log_${runId}`

### Multi-tab

All state is keyed by `runId`, so multiple tabs running different deploys are independent.

## Build & Release

- `yarn build` → both dev + minified into project root
- `yarn build:dev` / `yarn build:prod` → individual builds
- `yarn start` / `yarn dev` → local userscript server for direct GitHub debugging; install `__vite-plugin-monkey.install.user.js` once in Tampermonkey
- `yarn dev:build` / `yarn dev:all` → build watch modes
- `yarn preview:ui` → local Vite preview for the My PRs sidebar
- **Always run `yarn build` after touching `src/**`** before committing — both `.user.js` files must be in sync with source.
- Release: `yarn release -- patch|minor|major` (release-it bumps + builds + commits + tags), then `git push --follow-tags origin main` → `.github/workflows/release.yml` creates GitHub Release with both artifacts. Full procedure: `.agents/skills/release/SKILL.md`.

## Commit Convention

Conventional Commits enforced by commitlint. See `.agents/skills/commit/SKILL.md` — includes mandatory **Phase 3 docs-sync check** that prompts the user about updating `README.md` / `README.zh-CN.md` / `.github/copilot-instructions.md`.

## Do / Don't

- ✅ Use `scheduleTick` / `cancelTick` for any periodic work
- ✅ Key all new persistent state by `runId`
- ✅ Update `lastProgressAt` on any meaningful action so watchdog doesn't trigger
- ❌ Don't gate log writes behind the `saveLog` flag
- ❌ Don't call `setTimeout` directly for the main poll loop
- ❌ Don't add a GitHub token flow — DOM only
- ❌ Don't run the script on non-Deploy (PRD) workflow runs (the label check exists to keep behavior scoped)
