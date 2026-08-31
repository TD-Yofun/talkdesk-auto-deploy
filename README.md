# Auto-Approve Deploy Gates

**English** | [中文](README.zh-CN.md)

A Tampermonkey userscript that automatically approves GitHub Actions deployment gates — no more manual clicking through multi-environment deploy pipelines.

**No GitHub token required.** The script detects the break-glass button via DOM and clicks through the confirmation dialog using your existing browser session.

Built with **Vite + TypeScript**, outputs `build/auto-approve-deploy.user.js` (dev) and `build/auto-approve-deploy.min.user.js` (minified) as bundled userscripts. The `build/` folder is gitignored — artifacts are produced by CI and published to GitHub Releases.

## Features

- **DOM-only auto-approver** — Prefers GitHub's "Review deployments" flow, checks every pending deployment, then clicks "Approve and deploy"; falls back to "Start all waiting jobs"
- **Targets only `Deploy (PRD)` runs** — Activates only when the page header workflow label matches `Deploy (PRD)` (substring match, emoji-prefix tolerant)
- **Auto-stop + summary report** — Reads workflow conclusion from the page status badge (`success`/`failure`/`cancelled`/`timed_out`/`skipped`); stops automatically and generates a report
- **Desktop notification** — `GM_notification` pops a system notification when a run reaches a terminal state (click to focus the tab)
- **Copy report as Markdown** — One-click copy of the execution report to clipboard
- **Pause / Resume** — Suspend monitoring without losing counters or session state
- **Background-tab resistant** — Uses a dedicated Web Worker for the poll timer so browsers don't throttle to ≥1 min in background tabs
- **Watchdog auto-reload** — If no progress for 10 minutes, the page reloads and monitoring resumes from session state
- **Persistent across refreshes** — Counters, event timeline, and logs are restored after page reload via `wasRunning()` detection
- **Logs always persisted** — Per-run log buffer survives refresh; download as `aad-run-<runId>.log` anytime
- **Overview widget** — On non-run GitHub pages, a floating panel shows all currently monitored runs with quick-jump links
- **My PRs sidebar section** — On `github.com/`, adds your open pull requests and open PRs reviewed by you below Top repositories; each PR opens in a new tab
- **bfcache safe** — `pageshow.persisted` re-initializes the panel after browser back/forward navigation
- **Global error capture** — `window.error` and `unhandledrejection` are surfaced into the panel log
- **Version check** — Compares against the latest public userscript release asset; outdated scripts are blocked with a prominent install link
- **Multi-tab safe** — Each tab (different `runId`) operates independently; all state is keyed by `runId`

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the link below to install the userscript:

   - **[auto-approve-deploy.min.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js)** (recommended)
   - [auto-approve-deploy.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.user.js) (unminified, for debugging)

3. That's it — no token, no configuration required.

## Usage

1. Navigate to a Deploy (PRD) workflow run (`github.com/{owner}/{repo}/actions/runs/{id}`)
2. The side panel appears on the right edge of the page
3. Click **▶ Start** to begin monitoring
4. The script will:
   - Watch the DOM for "Review deployments", check every pending deployment, and approve it; use "Start all waiting jobs" only as a fallback
   - Poll every `interval` seconds as a fallback
   - Auto-stop and show a summary report when the workflow reaches a terminal state
   - Pop a desktop notification with the outcome

### Controls

| Control | Description |
|---------|-------------|
| **▶ Start / ⏹ Stop** | Toggle monitoring |
| **⏸ Pause / ▶ Resume** | Suspend without losing counters; visible only while running |
| **⏱ Interval** | Poll interval in seconds (5–300, default 15) |
| **💾 Log** | Toggle the log-file hint display (logs are always persisted regardless) |
| **📥** | Download the current run's log file (`aad-run-<runId>.log`) |
| **📋 Copy MD** | (in summary report) copy the execution report as Markdown |

> Interval and log controls are disabled during execution to prevent accidental changes.

### Panel Interactions

- Click the **◀ AAD** tab on the right edge to expand/collapse the panel
- **▶** button in the header collapses the panel

### Overview Widget

When you're on any GitHub page that is **not** a Deploy (PRD) run, a small floating widget in the bottom-right shows all runs currently being monitored across your tabs (within the last 30 minutes). Click an entry to jump to that run.

### My PRs Sidebar Section

On the GitHub home page, a separate section below Top repositories loads your open PRs and open PRs reviewed by you through your signed-in GitHub session. It uses the current GitHub login as the author/reviewer filter, loads once when you enter the home page, and loads again only when you click refresh. When active runs exist on the home page, their overview remains a separate bottom-left widget.

## How It Works

```
                  ┌────────────────────┐
                  │   Page Load (any   │
                  │  github.com page)  │
                  └─────────┬──────────┘
                            │
            ┌───────────────▼───────────────┐
            │ URL = /…/actions/runs/<id>?   │
            │   AND header label matches    │
            │       /Deploy\s*\(PRD\)/      │
            └─┬─────────────────────────────┘
       No     │ Yes
   ┌──────────▼─────────────┐      ┌─────────────────────────┐
   │ Show overview widget    │      │ Build side panel + log  │
   │ if active runs exist    │      │ store; restore logs;    │
   └────────────────────────┘      │ resume if previously    │
                                    │ running                 │
                                    └────────┬────────────────┘
                                             │
                                  ┌──────────▼──────────────┐
                                  │ User clicks ▶ Start     │
                                  └──────────┬──────────────┘
                                             │
                            ┌────────────────▼────────────────┐
                            │ MutationObserver + Worker-based │
                            │ poll loop (interval seconds)    │
                            └────────────────┬────────────────┘
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
            ┌──────────▼──────────┐  ┌───────▼───────┐   ┌─────────▼──────────┐
            │ "Review deployments"│  │  Run reached  │   │ No progress for    │
            │ or legacy button    │  │  terminal     │   │ 10 min (watchdog)? │
            │ appears?            │  │  conclusion?  │   └─────────┬──────────┘
            └──────────┬──────────┘  └───────┬───────┘             │ Yes
                       │ Yes                 │ Yes                 ▼
            ┌──────────▼──────────┐  ┌───────▼─────────────┐  ┌─────────────┐
            │ Click → check every │  │ Stop + generate     │  │ location.   │
            │ deployment → approve│  │ summary report →    │  │ reload();   │
            │ enabled dialog      │  │ desktop notification│  │ auto-resume │
            └──────────┬──────────┘  └─────────────────────┘  └─────────────┘
                       │
              ┌────────▼────────┐
              │ Cooldown 5s →   │
              │ continue poll   │
              └─────────────────┘
```

## How Deployment Approval Works

The script prefers GitHub's current review flow:

1. **Click "Review deployments"** → wait for the `js-gates-dialog` dialog → check every `gate_request[]` checkbox → wait for **"Approve and deploy"** to become enabled → click it
2. **Fall back to "Start all waiting jobs"** and its confirmation dialog when the review button is absent
3. If the legacy dialog cannot be completed, use the existing DOM-based fallbacks: programmatic form submission with `gate_request[]` fields collected from the DOM, then a same-origin manual POST using a page CSRF token.

All three rely on your existing browser session cookies — no API token is needed.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18.12
- Corepack (bundled with supported Node.js releases)

### Setup

```bash
corepack enable
yarn install
```

### Build

```bash
yarn build        # both dev + minified
yarn build:dev    # dev only
yarn build:prod   # minified only
```

### Watch Mode

```bash
yarn start            # serve the local userscript for direct GitHub debugging
yarn dev              # alias for yarn start
yarn dev:build        # rebuild the development userscript on change
yarn dev:all          # rebuild both on change
yarn preview:ui       # local My PRs widget mock preview at http://127.0.0.1:5173
```

For direct GitHub debugging, run `yarn start` and install the local development
userscript once from [http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js](http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js).
After that, refresh any matching GitHub page after changing source files.

### Project Structure

```
src/
  main.ts              ← Entry point — wires modules, page detection, lifecycle
  core/
    config.ts          ← Persistent config (interval, saveLog hint, panelVisible)
    state.ts           ← Runtime state types + watchdog constant
    log-store.ts       ← Always-on log persistence (batch buffer, debounced flush)
    session.ts         ← Session persistence across refreshes
    scheduler.ts       ← Web Worker-based timer (avoids background tab throttling)
    pull-requests.ts   ← Signed-in GitHub HTML pull request discovery
    version-check.ts   ← Compare against latest userscript release asset; cache result
  api/
    skip-timers.ts     ← MutationObserver + 3-approach DOM-based clicker
  ui/
    styles.ts          ← Injects compiled Sass through GM_addStyle
    styles.scss        ← Panel, overview, and sidebar Sass styles
    ui.ts              ← Panel build, render, event binding, summary + Markdown export
    overview.ts        ← Floating active-runs widget for non-run pages
    pr-overview.ts     ← GitHub home pull request widget
  utils/
    helpers.ts         ← ts(), esc(), formatDuration()
    url.ts             ← URL parsing + Deploy (PRD) page detection
```

### Build Output

| File | Description |
|------|-------------|
| `build/auto-approve-deploy.user.js` | Dev build — unminified, readable (gitignored) |
| `build/auto-approve-deploy.min.user.js` | Prod build — minified JS + compressed CSS/HTML templates (gitignored) |

### Release Flow

Local: `yarn release -- patch` (release-it) bumps version, builds, commits, tags. Then `git push --follow-tags origin main` triggers `.github/workflows/release.yml` which creates the GitHub Release and uploads both `.user.js` artifacts. See `.agents/skills/release/SKILL.md` for the full workflow.

## License

MIT
