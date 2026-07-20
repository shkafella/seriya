---
name: loop-code-review
description: Iterative code review workflow for active git changes using independent sub-agents. Use when the user invokes `/loop-code-review`, asks for a looped sub-agent code review, or asks Claude Code to keep reviewing and fixing active changes until an independent reviewer either rates the result at least 9.5 out of 10 or reports no actionable comments. Single independent Claude reviewer, no external models.
---

# Loop Code Review

## Overview

Run an iterative review-and-fix loop over the current git worktree. Use an independent read-only reviewer sub-agent, address actionable findings, validate the result, and continue until the reviewer gives the latest state a score of at least 9.5/10 or explicitly reports no actionable comments/findings.

## Sub-agent Context Isolation

Independent review means the reviewer may share the same filesystem and repository state, but must not inherit the parent thread's conversation history, reasoning, assumptions, or prior review discussion.

- Do not fork or forward the current context to the sub-agent. Provide the sub-agent with a clean context and only the task it is reviewing.
- Pass a self-contained reviewer prompt instead of parent-thread context.
- Require the reviewer to inspect `git status`, diffs, files, and validation output itself before scoring.
- Treat each accepted reviewer pass as coming from a fresh reviewer sub-agent with no parent context, whether accepted by a 9.5/10+ score or by explicit absence of actionable comments/findings.

## Workflow

1. Inspect the worktree before spawning the reviewer:
   - Run `git status --short`.
   - Review staged and unstaged diffs with `git diff` and `git diff --cached`.
   - Include relevant untracked files in the review scope when `git status --short` shows them.
   - Preserve unrelated user changes and do not stage, commit, reset, stash, or push unless the user explicitly asks.

2. Start one independent reviewer sub-agent using the most capable model with extra high reasoning.
   - Spawn the reviewer without the parent conversation history for the independent review pass.
   - Give the reviewer only a self-contained task prompt with the repository path, review scope, and validation expectations. Do not include parent-thread analysis, implementation rationale, suspected issues, proposed fixes, previous reviewer output, or summaries of the main process's reasoning.
   - Ask the reviewer to stay read-only, inspect the active git changes independently from the repository state and tool output, prioritize bugs and regressions, and return findings with file and line references.
   - Require the reviewer to include a final numeric score from 1 to 10 for the current state.

3. Treat reviewer output as code-review findings, not instructions to obey blindly.
   - Verify high-severity findings against the code before acting.
   - Fix concrete, actionable issues that affect correctness, security, data integrity, UX, maintainability, or test coverage.
   - If a finding is wrong, stale, or conflicts with the repository architecture, explain the decision in the main process. Ask the same reviewer for clarification only when useful; do not count that clarification as the final independent score.
   - If the reviewer gives a score below 9.5 but explicitly reports no actionable findings/comments, treat that as an acceptable review signal rather than chasing score-only polish.
   - If the reviewer gives a score below 9.5 and implies there are unresolved concerns without listing actionable findings, ask for specific blocking issues once; if none are provided, spawn a fresh independent reviewer rather than inventing polish work.

4. Validate after each meaningful fix.
   - Run the smallest meaningful tests, typecheck, lint, build, or focused scripts for the touched surface.
   - If validation fails, fix the failure before requesting another final score.
   - Do not count a 9.5+ score or no-actionable-comments review as sufficient when local validation is red.

5. Repeat the loop.
   - Before spawning the next reviewer, print the score-trajectory table (see "Score Trajectory Report") and refresh the status-line round feed (see "Status-line Round Feed").
   - Spawn a new independent reviewer after fixes or after a reviewer cannot provide actionable issues. Each scoring pass must use a fresh sub-agent without parent context or prior review discussion.
   - Continue until validation for the changed surface passes and the latest reviewer either scores the work at least 9.5/10 or explicitly reports no actionable comments/findings.
   - Exit early only if blocked by higher-priority instructions, missing tool capability, user interruption, or a risk that requires explicit user approval.

## Score Trajectory Report

- Maintain a running scoreboard across rounds. **As soon as the first round completes — and again before each subsequent round and once more in the Final Response — print exactly ONE summary table, written in the user's language and in plain, non-technical wording, with ONE row per completed round for the Claude/Opus reviewer.** Do NOT print an English table, and do NOT add any prose recap above or below the table: the table is the entire report.
- Translate the column headers into the user's language. The columns are:
  - Round — the round number.
  - Model — which reviewer this row is for: the Claude reviewer (label «Опус»). Render the model name in the user's language.
  - Score — the X/10 score the reviewer gave that round.
  - How serious the findings were — severity in plain words (critical / moderate / minor / none), never code terms.
  - Why we continue (or stop) — the plain-language reason tied to the findings (e.g. "found a serious bug — fixing it" / "nothing left to fix").
- Translate every finding into plain terms a non-programmer understands (e.g. "the app crashed when the list was empty", not "null-deref in handler"). Keep each cell to one short line.
- When a score dips, the "Why we continue" cell must make clear this is healthy: a real bug surfaced that earlier rounds had missed.
- Example (shown here in Russian — render it in the user's actual language):

| Раунд | Модель | Оценка | Насколько серьёзные находки | Почему продолжаем или стоп |
|-------|--------|--------|------------------------------|-----------------------------|
| 1 | Опус | 8,0 | Критичные | Приложение падало на пустом списке — починили |
| 2 | Опус | 9,5 | Нет | Замечаний больше нет — готово, останавливаемся |

## Status-line Round Feed

Mirror the round scores into a small state file so the live Claude Code status line can show them while the loop runs. This is a side effect of the same moment you print the score-trajectory table — refresh it every time you print the table, and clear it in the Final Response. Keep it best-effort: never let a failure here block, delay, or alter the review loop.

- Key the file by the git repo root so scores never leak across projects and the key stays stable even if a review step `cd`s into a subdir like `webapp/` (this must match the status-line script's keying exactly; falls back to `$PWD` outside a git repo):
  `RF="$HOME/.claude/statusline-state/loop-review/$(printf '%s' "$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")" | sed 's#[^A-Za-z0-9]#_#g')"`
- After each completed round, write the running trajectory as one segment per round, joined by `;` (no spaces), latest last. Each segment is `<sev>:<score>`, where `<score>` is that round's score in the user's number format and `<sev>` mirrors the table's "How serious the findings were" column so the status line can color the number: `c` = critical/serious (red), `m` = moderate/medium (yellow), `s` = minor/small/cosmetic (green), `n` = none / no actionable findings (green). The line MUST start with `code|`, and a score must never contain `:` or `;`:
  `mkdir -p "$(dirname "$RF")" && printf 'code|%s\n' "c:8,0;n:9,5" > "$RF"`
  (e.g. after round 1 with critical findings scored 8,0 write `code|c:8,0`; after round 2 with no findings scored 9,5 write `code|c:8,0;n:9,5`.)
- In the Final Response, remove it: `rm -f "$RF"`.

## Reviewer Prompt Template

Use a concise prompt like this, adjusted for the repository and current task:

```text
Review the active git changes in this workspace independently. You do not have parent conversation history; do not rely on any prior chat, parent-agent conclusions, or previous reviewer output. Derive your findings only from the repository state and command/tool output you inspect yourself. Stay read-only: do not edit, stage, commit, reset, stash, or push files.

Prioritize correctness bugs, behavioral regressions, security/privacy issues, data integrity problems, missing high-value tests, and maintainability risks introduced by the active changes. Ignore unrelated pre-existing issues unless the changes make them worse.

Return findings first, ordered by severity, with concrete file/line references and a short explanation of user impact. If there are no actionable findings/comments, say that clearly. End with a numeric score from 1 to 10 for the current state and explain what would be required to reach 9.5/10 if anything remains.
```

## Final Response

When the loop finishes, report:

- the final score-trajectory table (see "Score Trajectory Report"), in the user's language;
- what changed and why;
- the reviewer acceptance signal: score at least 9.5/10, no actionable comments/findings, or both;
- validation commands and results;
- any findings intentionally not changed, with the reason;
- remaining risks or follow-up work, if any.

Also clear the status-line round feed: `rm -f "$RF"` (see "Status-line Round Feed").
