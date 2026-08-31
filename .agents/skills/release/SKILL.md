---
name: release
description: 'Publish a new release: local `release-it` bumps/builds/commits/tags, agent pushes, GitHub Actions creates the GitHub Release. Use when the user asks to release, publish, cut a version, or says "release", "发布", "出新版本".'
argument-hint: 'Optional: patch | minor | major | x.y.z'
---

# Release Workflow

Releases are split between **local** and **CI**:

| Step | Where | Tool |
|---|---|---|
| Bump `package.json` | local | release-it |
| Build `.user.js` artifacts | local | `yarn build` (release-it `after:bump` hook) |
| Update `CHANGELOG.md` | local | `@release-it/conventional-changelog` |
| Commit `chore: release v<x.y.z>` | local | release-it |
| Create annotated tag `v<x.y.z>` | local | release-it |
| Push commit + tag | local | `git push --follow-tags` |
| Create GitHub Release + upload assets | **CI** | `.github/workflows/release.yml` triggered by tag push |

Per `.release-it.json`: `git.push = false`, `github.release = false`. release-it never talks to api.github.com locally (the dev machine sits behind a proxy octokit cannot traverse).

---

## The single user decision: which bump

The agent runs the entire release end-to-end. The **only** thing the user must confirm is the version bump type.

### Pre-flight (silent — abort with a clear message if any fails)

- Working directory clean (no uncommitted changes)
- Current branch is `main`
- Not behind `origin/main` (being ahead is fine)

### Ask the user — exactly once

Show:

1. Current version (from `package.json`)
2. Commits since the last tag (`git log --format='%h %s' $(git describe --tags --abbrev=0)..HEAD`)
3. Reference table:

| Convention | Typical bump |
|---|---|
| `feat!:` / `BREAKING CHANGE` | `major` |
| `feat:` | `minor` |
| `fix:` / `perf:` / `refactor:` / `docs:` / `chore:` | `patch` |

Ask: **"Which bump — `patch`, `minor`, `major`, or an exact `x.y.z`?"**

If the user already specified a bump in their request (e.g. "发布 patch"), accept it directly — do **not** re-ask.

### Then run the rest end-to-end (no further prompts)

```
yarn release -- <bump> --ci
git push --follow-tags origin main
```

A `WARNING Environment variable "GITHUB_TOKEN" is required...` line from release-it may appear — ignore it; CI handles the GitHub Release.

### Verify CI and report

```
gh run watch --exit-status $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh release view v<x.y.z>
```

Report to the user:
- Workflow status
- Release URL
- Both assets present (`auto-approve-deploy.user.js`, `auto-approve-deploy.min.user.js`)

---

## Edge cases (these DO require explicit user confirmation)

The agent must stop and ask the user before acting on any of these:

- **Working tree dirty** — never stash/discard without confirmation
- **Tag already exists** locally or on remote — never delete tags automatically
- **Build fails during `after:bump`** — report the failure and ask before retrying
- **Behind `origin/main`** — instruct the user to pull first
- **No conventional commits since last tag** — warn (CHANGELOG section will be empty) and ask whether to proceed
- **CI fails after push** — show the failure and ask whether to rerun (`gh run rerun <id>`) or fix and re-release
- **First release** (no prior tag) — ask what initial version to publish
- **Non-main branch** — abort; current config requires `main`

---

## Notes

- Always pass `--ci` to release-it to skip its interactive prompts (we own confirmation at the skill level).
- If you must inspect dry-run output for debugging, run `yarn release:dry -- <bump> --ci > /tmp/dry.log 2>&1` and read the file. Do not pipe through `tee`/`tail` (line-buffered output can hide prompts).
- The CI workflow checks that `package.json` version matches the pushed tag and uploads both `.user.js` files via `softprops/action-gh-release@v2`.
