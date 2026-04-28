# Auto-Approve Deploy Gates

**English** | [中文](README.zh-CN.md)

A Tampermonkey userscript that automatically approves GitHub Actions deployment gates and skips wait timers — no more manual clicking through multi-environment deploy pipelines.

Built with **Vite + TypeScript**, outputs `auto-approve-deploy.user.js` (dev) and `auto-approve-deploy.min.user.js` (minified) as bundled userscripts.

## Features

- **Auto-approve deployment gates** — Detects pending deployment approvals via GitHub REST API and approves them automatically
- **Skip wait timers** — Bypasses environment wait timers through DOM interaction (what API tokens can't do)
- **Persistent state** — Survives page refreshes; auto-resumes monitoring after reload
- **Grace period** — Tolerates "Re-run all jobs" delays (90s) before declaring a run complete
- **Local log storage** — Optionally saves per-run logs to browser storage with download support
- **Side panel UI** — Dark-themed, collapsible side panel with real-time status and execution summary report

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the link below to install the userscript:

   - Full version: **[auto-approve-deploy.user.js](https://github.com/TD-Yofun/talkdesk-auto-deploy/raw/main/auto-approve-deploy.user.js)**
   - Minified version: **[auto-approve-deploy.min.user.js](https://github.com/TD-Yofun/talkdesk-auto-deploy/raw/main/auto-approve-deploy.min.user.js)**

3. On first use, click **🔑 Token** to set your GitHub personal access token (run `gh auth token` in terminal to get one)

## Usage

1. Navigate to any GitHub Actions run page (`github.com/{owner}/{repo}/actions/runs/{id}`)
2. The side panel appears on the right edge of the page
3. Click **▶ Start** to begin monitoring
4. The script will:
   - Poll the run status every 15s (configurable)
   - Auto-approve any pending deployment gates
   - Attempt to skip wait timers via page DOM interaction
   - Stop automatically when the run completes and show a summary report

### Controls

| Control | Description |
|---------|-------------|
| **▶ Start / ⏹ Stop** | Toggle monitoring |
| **⏱ Interval** | Poll interval in seconds (5–300) |
| **Approve** | Enable/disable auto-approve |
| **Skip timers** | Enable/disable wait timer skipping |
| **💾 Log** | Enable local log persistence |
| **📥** | Download log file for current run |
| **🔑 Token** | Set GitHub personal access token |

> All config controls are disabled during execution to prevent accidental changes.

### Panel Interactions

- Click the **◀ AAD** tab on the right edge to expand/collapse the panel
- **▶** button in the header to collapse
- **×** to close the panel entirely

## Execution Flow

```
                         ┌────────────┐
                         │ Page Load  │
                         └─────┬──────┘
                               │
                    ┌──────────▼──────────┐
                    │ URL matches          │
                    │ actions/runs/*?      │
                    └──┬───────────────┬──┘
                   No  │               │ Yes
                  ┌────▼──┐  ┌─────────▼──────────────┐
                  │ Exit  │  │ Parse URL · Load Config │
                  └───────┘  │ · Inject UI             │
                             └─────────┬───────────────┘
                                       │
                            ┌──────────▼──────────┐
                            │   Token configured?  │
                            └──┬───────────────┬──┘
                           No  │               │ Yes
                     ┌─────────▼──────┐  ┌─────▼──────────┐
                     │ Prompt for     │  │ Fetch run info  │
                     │ GitHub token   │  └─────┬──────────┘
                     └────────────────┘        │
                                    ┌──────────▼──────────┐
                                    │ Was running before   │
                                    │ page refresh?        │
                                    └──┬───────────────┬──┘
                                   Yes │               │ No
                            ┌──────────▼──┐   ┌────────▼───────────┐
                            │ Resume:     │   │ Wait for user to   │
                            │ restore     │   │ click ▶ Start      │
                            │ session     │   └────────┬───────────┘
                            └──────┬──────┘            │
                                   └────────┬──────────┘
                                            │
                    ┌───────────────────────►│
                    │               ┌───────▼────────┐
                    │               │   POLL LOOP     │
                    │               └───────┬────────┘
                    │                       │
                    │            ┌──────────▼──────────┐
                    │            │ Fetch run status     │
                    │            │ via GitHub API       │
                    │            └──────────┬──────────┘
                    │                       │
                    │            ┌──────────▼──────────┐
                    │            │  Run completed?      │
                    │            └──┬───────────────┬──┘
                    │           Yes │               │ No
                    │    ┌─────────▼──────────┐    │
                    │    │ Grace period active │    │
                    │    │ & no approvals yet? │    │
                    │    └──┬──────────────┬──┘    │
                    │   Yes │              │ No     │
                    │ ┌─────▼─────────┐ ┌──▼─────────────────┐
                    │ │ Wait for      │ │ Generate summary   │
                    │ │ re-run to     │ │ report · Stop      │
                    ├─┤ propagate     │ └────────────────────┘
                    │ └───────────────┘
                    │                          │
                    │               ┌──────────▼──────────┐
                    │               │ Fetch pending        │
                    │               │ deployments          │
                    │               └──────────┬──────────┘
                    │                          │
                    │               ┌──────────▼──────────┐
                    │               │ Approvable gates     │
                    │               │ found?               │
                    │               └──┬───────────────┬──┘
                    │              Yes │               │ No
                    │       ┌─────────▼──────────┐    │
                    │       │ Approve via        │    │
                    │       │ GitHub API         │    │
                    │       └─────────┬──────────┘    │
                    │                 │               │
                    │       ┌─────────▼──────────┐    │
                    ├───────┤ Quick re-poll (5s)  │    │
                    │       └────────────────────┘    │
                    │                          ┌──────▼──────────┐
                    │                          │ Wait timer gates │
                    │                          │ found?           │
                    │                          └──┬───────────┬──┘
                    │                         Yes │           │ No
                    │              ┌──────────────▼────┐      │
                    │              │ Already attempted  │      │
                    │              │ this environment?  │      │
                    │              └──┬─────────────┬──┘      │
                    │            Yes │             │ No       │
                    │                │    ┌────────▼───────┐  │
                    │                │    │ Try skip via   │  │
                    │                │    │ DOM interaction │  │
                    │                │    └────────┬───────┘  │
                    │                │    ┌────────▼───────┐  │
                    │                │    │ Skip success?  │  │
                    │                │    └──┬──────────┬──┘  │
                    │                │   Yes │          │ No  │
                    │         ┌──────▼──┐    │          │     │
                    │         │ Wait for│    │          │     │
                    │         │ timer   │ ┌──▼────────────┐  │
                    │         │ expire  │ │ Page refresh · │  │
                    │         └────┬────┘ │ Resume session │  │
                    │              │      └───────┬────────┘  │
                    │              │              │            │
                    │       ┌──────▼──────────────▼──┐        │
                    │       │ Schedule next poll     │◄───────┘
                    └───────┤ (interval seconds)     │
                            └────────────────────────┘
```

## Token Permissions

The GitHub token needs the following scope:

- `repo` — Required to read workflow runs and approve deployments

## How Skip Wait Timers Works

The script attempts 3 approaches in order:

1. **Click "Start all waiting jobs"** → check environment checkboxes in dialog → click confirm button
2. **Submit the skip form** with `gate_request[]` fields injected
3. **Manual POST** using CSRF token extracted from the page

This uses your browser session cookies (not the API token), which is why it only works in-browser.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- npm

### Setup

```bash
npm install
```

### Build

```bash
# Build both dev and minified versions
npm run build

# Build dev version only
npm run build:dev

# Build minified version only
npm run build:prod
```

### Watch Mode

```bash
# Watch and rebuild dev version on file changes
npm run dev

# Watch and rebuild both versions on file changes
npm run dev:all
```

### Project Structure

```
src/
  main.ts              ← Entry point
  core/                ← State & persistence
    config.ts          ← Persistent config (GM_getValue/GM_setValue)
    state.ts           ← Runtime state types & factory
    log-store.ts       ← Log persistence (batch buffer, debounced flush)
    session.ts         ← Session persistence across page refreshes
  api/                 ← Network & DOM interaction
    api.ts             ← GitHub REST API layer (GM_xmlhttpRequest)
    skip-timers.ts     ← DOM-based skip wait timers (3 approaches)
  ui/                  ← Rendering
    styles.ts          ← CSS injection via GM_addStyle
    ui.ts              ← Panel build, render, event binding
  utils/               ← Helpers
    helpers.ts         ← ts(), esc(), formatDuration()
    url.ts             ← URL parsing (owner/repo/runId)
```

### Build Output

| File | Description |
|------|-------------|
| `auto-approve-deploy.user.js` | Dev build — unminified, readable |
| `auto-approve-deploy.min.user.js` | Prod build — minified JS + compressed CSS/HTML templates |

## License

MIT
