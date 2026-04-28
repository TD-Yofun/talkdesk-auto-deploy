# Auto-Approve Deploy Gates

A Tampermonkey userscript that automatically approves GitHub Actions deployment gates and skips wait timers — no more manual clicking through multi-environment deploy pipelines.

## Features

- **Auto-approve deployment gates** — Detects pending deployment approvals via GitHub REST API and approves them automatically
- **Skip wait timers** — Bypasses environment wait timers through DOM interaction (what API tokens can't do)
- **Persistent state** — Survives page refreshes; auto-resumes monitoring after reload
- **Grace period** — Tolerates "Re-run all jobs" delays (90s) before declaring a run complete
- **Local log storage** — Optionally saves per-run logs to browser storage with download support
- **Dark-themed floating panel** — Draggable, minimizable, non-intrusive UI with real-time status

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the link below to install the userscript:

   **[Install auto-approve-deploy.user.js](https://github.com/TD-Yofun/talkdesk-auto-deploy/raw/main/auto-approve-deploy.user.js)**

3. On first use, click **🔑 Token** to set your GitHub personal access token (run `gh auth token` in terminal to get one)

## Usage

1. Navigate to any GitHub Actions run page (`github.com/{owner}/{repo}/actions/runs/{id}`)
2. The floating panel appears at the bottom-right corner
3. Click **▶ Start** to begin monitoring
4. The script will:
   - Poll the run status every 30s (configurable)
   - Auto-approve any pending deployment gates
   - Attempt to skip wait timers via page DOM interaction
   - Stop automatically when the run completes

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

- **Drag** the header to reposition
- **Double-click** the header to reset to bottom-right
- **−** to minimize, **×** to close

## Token Permissions

The GitHub token needs the following scope:

- `repo` — Required to read workflow runs and approve deployments

## How Skip Wait Timers Works

The script attempts 3 approaches in order:

1. **Click "Start all waiting jobs"** → check environment checkboxes in dialog → click confirm button
2. **Submit the skip form** with `gate_request[]` fields injected
3. **Manual POST** using CSRF token extracted from the page

This uses your browser session cookies (not the API token), which is why it only works in-browser.

## License

MIT
