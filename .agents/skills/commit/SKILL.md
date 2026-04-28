---
name: commit
description: 'Create well-structured git commits following Conventional Commits with mandatory scope. Use when the user asks to commit, create commits, stage and commit, group commits, fix commit messages, or says "commit", "提交", "msg". Groups changed files by package/scope, writes descriptive commit bodies, appends AI co-author trailer, and audits existing local commits against remote develop.'
argument-hint: 'Optional: specific scope or files to commit'
---

# Commit Workflow

Create git commits that follow Conventional Commits with mandatory scope, grouped by package, with descriptive bodies and AI co-author trailers. All commit titles and body text must be in **English**.

The workflow has 4 phases. Maximize parallelism within each phase — run independent commands and reads simultaneously. Ask the user **only once** for confirmation (in Phase 3) to keep the flow fast.

---

## Phase 1 — Collect Context (parallel)

Run these commands **simultaneously** to gather all needed context in one round-trip:

```
git fetch origin develop
git log --format='%H %s' origin/develop..HEAD
git status --short
```

From the results, extract:

- **Local-ahead commits**: list from `git log` (may be empty)
- **Changed files**: list from `git status` (may be empty)

If both are empty, nothing to do — report and stop.

---

## Phase 2 — Quality Gate (parallel, fix if needed)

### 2a. Audit existing commits

Validate each local-ahead commit title:

- Must match `type(scope): description` (scope **required**)
- Valid types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `ci`, `build`, `revert`
- Description: English, lowercase start, no trailing period

If violations exist, record them for the Phase 3 report. Do **not** rewrite yet.

### 2b. Lint + TypeScript (parallel)

Run simultaneously:

- `pnpm lint` — expect 0 errors (pre-existing warnings OK)
- `pnpm --filter <pkg> exec tsc --noEmit` for each changed component package

If errors are found, fix them immediately (auto-fix with `pnpm lint:fix`, then manual fix for remaining). Re-run until clean before proceeding. Pre-existing errors from unrelated packages (e.g., `google-map`) are acceptable.

### 2c. Storybook & instructions gap analysis (read-only)

While lint/tsc run, **read files in parallel** to detect gaps:

**Storybook check** — for each changed component under `packages/react/{name}/`:

1. Check if `packages/docs/src/stories/react/{name}/` exists.
2. If it exists, scan for outdated API tables, missing examples for new/changed props, missing story exports.
3. If it doesn't exist and this is a new component, flag it.
4. Record findings (e.g., "tooltip: new `size` prop not in Installation.mdx or examples").

**copilot-instructions.md check** — scan for:

- New skill added → Skills table needs a row
- New package → Project Structure may need update
- Changed conventions → relevant section may need update

Record findings. Do **not** make changes yet — everything is presented in Phase 3.

---

## Phase 3 — Plan & Confirm (single user interaction)

### 3a. Categorize & group changes

Map each changed file to a **scope**:

| Path pattern                                        | Scope                                 |
| --------------------------------------------------- | ------------------------------------- |
| `packages/react/{name}/`                            | `{name}` (e.g., `trigger`, `tooltip`) |
| `packages/hooks/{name}/`                            | `hooks-{name}`                        |
| `packages/marketplace/{name}/`                      | `{name}`                              |
| `packages/docs/`                                    | `docs`                                |
| `packages/tools/{name}/`                            | `tools-{name}`                        |
| `.config/`, `.github/`, `.agents/`                  | `config`                              |
| `scripts/`                                          | `scripts`                             |
| `kci-scripts/`                                      | `ci`                                  |
| Root files (`package.json`, `pnpm-lock.yaml`, etc.) | `deps` or `config`                    |

Group into commits: **one scope per commit**. Lockfile follows the commit that caused the dependency change.

Determine **type** per group:

- New feature/prop → `feat` | Bug fix → `fix` | Docs/storybook → `docs`
- Restructuring → `refactor` | Formatting → `style` | Tests → `test` | Config → `chore`/`build`

### 3b. Draft commit messages

For each group:

```
type(scope): short summary in lowercase

- What changed and why (bullet list)
- Focus on behavior, not file names

Co-authored-by: <dynamic trailer>
```

**Title**: `type(scope): description` — scope mandatory, English, lowercase start, no period, imperative mood, ≤72 chars.

**Body**: English, bullet list of meaningful changes, wrap at 72 chars.

**AI co-author trailer** (detect current model):

| Model        | Trailer                                              |
| ------------ | ---------------------------------------------------- |
| Claude       | `Co-authored-by: claude <noreply@anthropic.com>`     |
| GPT / OpenAI | `Co-authored-by: copilot <noreply@github.com>`       |
| Gemini       | `Co-authored-by: gemini <noreply@google.com>`        |
| Other        | `Co-authored-by: ai-assistant <noreply@example.com>` |

### 3c. Present everything & ask user ONCE

Show a single consolidated report with all findings, then ask for confirmation:

1. **Commit audit issues** (if any) — table of non-compliant commits with proposed fixes. Note whether they are already pushed (requires force-push) or local-only (safe to reword).

2. **Storybook gaps** (if any) — what's missing or outdated, ask if user wants to update now.

3. **copilot-instructions.md gaps** (if any) — what needs changing, ask if user wants to update now.

4. **Commit plan** — table of all planned commits:

   | #   | Type | Scope   | Title                                        | Files |
   | --- | ---- | ------- | -------------------------------------------- | ----- |
   | 1   | feat | tooltip | add size prop with small and medium variants | 4     |
   | 2   | docs | tooltip | add size example to storybook                | 3     |

Ask the user to confirm. The user can approve, adjust, or decline each section independently.

**After confirmation:**

- If user wants storybook updates → make them (or invoke `update-storybook` skill), add files to commit plan.
- If user wants copilot-instructions updates → make them, add to commit plan.
- If user wants to reword pushed commits → rebase and force-push. If declined → skip.
- If user wants to reword local commits → rebase with `reword` (or `--amend` for the latest).

---

## Phase 4 — Execute & Verify

For each commit group in order:

1. `git add <files>`
2. `git commit -m "<title>" -m "<body>" -m "Co-authored-by: ..."`
   - Do **not** use `--no-verify` — let pre-commit (lint-staged) and commit-msg (commitlint) hooks run.
   - If a hook fails, read the error, fix the issue, and retry.

After all commits, run `git log --format='%s' origin/develop..HEAD` and verify every title matches `type(scope): description`. Report the final commit list.

---

## Edge Cases

- **Single file**: Still use scoped commit — `fix(trigger): correct flip condition`
- **Cross-package**: Prefer separate commits per package. If truly inseparable, use the primary package as scope.
- **Root config**: `chore(config):` or `chore(deps):` as appropriate.
- **Docs only**: `docs(scope):` where scope is the documented component.
- **Amend last commit**: Use `git commit --amend` instead of new commit.
- **No unstaged changes**: Run audit-only mode (Phase 1 → 2a → report).
