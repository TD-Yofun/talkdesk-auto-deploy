---
name: commit
description: 'Create well-structured git commits following Conventional Commits. Use when the user asks to commit, create commits, stage and commit, fix commit messages, or says "commit", "提交", "msg".'
argument-hint: 'Optional: specific files or message hint'
---

# Commit Workflow

Create git commits following Conventional Commits for a single-file Tampermonkey userscript project. All commit titles and body text must be in **English**.

---

## Phase 1 — Collect Context

Run simultaneously:

```
git status --short
git log --format='%H %s' origin/main..HEAD
```

If no changes and no local-ahead commits, report and stop.

---

## Phase 2 — Categorize Changes

Map changed files to a commit type:

| File pattern | Type | Example |
|---|---|---|
| `auto-approve-deploy.user.js` | `feat` / `fix` / `refactor` / `perf` | depends on change nature |
| `README.md`, `README.zh-CN.md` | `docs` | |
| `.github/copilot-instructions.md` | `docs` | |
| `.agents/**` | `chore` | |
| `.github/**` (other) | `ci` / `chore` | |

Valid types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `style`, `ci`

This is a single-file project — most changes will be a single commit. Only split into multiple commits when changes are logically independent (e.g., a bug fix + unrelated docs update).

---

## Phase 3 — Draft & Confirm

### Commit message format

```
type: short summary in lowercase

- What changed and why (bullet list)
- Focus on behavior, not file names
```

**Title rules:**
- `type: description` — English, lowercase start, no period, imperative mood, ≤72 chars
- No scope required (single-file project, scope adds no value)

**Body:** English, bullet list, wrap at 72 chars. Optional for trivial changes.

### Present plan to user

Show the planned commit(s) and ask for confirmation once.

---

## Phase 4 — Execute

```
git add <files>
git commit -m "<title>" -m "<body>"
```

After committing, run `git log --oneline origin/main..HEAD` and report the result.

---

## Edge Cases

- **Mixed changes** (e.g., feature + docs): Prefer one commit if they're related. Split only if truly independent.
- **Amend last commit**: Use `git commit --amend` when the user asks to fix the previous commit.
- **No build/lint step**: This project has no linter, TypeScript, or build tools — skip quality gates.
