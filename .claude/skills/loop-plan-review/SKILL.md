---
name: loop-plan-review
description: Iterative plan review workflow for plan/spec documents using independent sub-agents. Use when the user invokes `/loop-plan-review`, asks for a looped sub-agent review of a plan document, or asks Claude Code to keep reviewing and improving a plan until an independent reviewer either rates it at least 9.5 out of 10 or reports no actionable comments, so the plan becomes execution-ready. Single independent Claude reviewer, no external models.
---

# Loop Plan Review

## Overview

Run an iterative review-and-improve loop over a plan document until it is execution-ready. Use an independent read-only reviewer sub-agent, fix actionable plan defects, verify factual claims against the repository, and continue until the reviewer gives the latest plan a score of at least 9.5/10 or explicitly reports no actionable comments/findings.

Execution-ready means: someone with repository access but no conversation history could implement the plan step by step without guessing — goals, ordering, file-level targets, acceptance criteria, risks, and validation are all stated and grounded in the real codebase.

## Plan Scope

- The target is the plan document passed as the skill argument (a file path). If no argument is given, use the plan most recently created or discussed in the conversation; if that is ambiguous, ask the user which document to review.
- Identify the plan's grounding sources before the first review pass: the product spec / TZ it implements, data-model docs, and the code areas it touches. Pass only file paths to the reviewer, never conclusions.
- Edits stay inside the plan document (and directly coupled plan docs when the user agrees). Do not implement the plan's code changes during this loop.

## Sub-agent Context Isolation

Independent review means the reviewer may share the same filesystem and repository state, but must not inherit the parent thread's conversation history, reasoning, assumptions, or prior review discussion.

- Do not fork or forward the current context to the sub-agent. Provide the sub-agent with a clean context and only the task it is reviewing.
- Pass a self-contained reviewer prompt instead of parent-thread context.
- Require the reviewer to read the plan and inspect the repository itself before scoring.
- Treat each accepted reviewer pass as coming from a fresh reviewer sub-agent with no parent context, whether accepted by a 9.5/10+ score or by explicit absence of actionable comments/findings.

## Workflow

1. Inspect the plan before spawning the reviewer:
   - Read the plan document end to end.
   - Locate the spec/TZ and code surfaces the plan references, so the reviewer prompt can name them as grounding sources.
   - Preserve unrelated user changes and do not stage, commit, reset, stash, or push unless the user explicitly asks.

2. Start one independent reviewer sub-agent using the most capable model with extra high reasoning.
   - Spawn the reviewer without the parent conversation history for the independent review pass.
   - Give the reviewer only a self-contained task prompt with the repository path, the plan file path, grounding-source paths, and the acceptance bar. Do not include parent-thread analysis, authoring rationale, suspected weaknesses, previous reviewer output, or summaries of the main process's reasoning.
   - Ask the reviewer to stay read-only, verify the plan's factual claims against the actual repository state (referenced files, schemas, routes, APIs, commands), and return findings with plan-section and file references.
   - Require the reviewer to include a final numeric score from 1 to 10 for execution-readiness of the current plan.

3. Treat reviewer output as plan-review findings, not instructions to obey blindly.
   - Verify high-severity claims against the repository before acting.
   - Fix concrete, actionable defects: wrong or stale claims about the codebase, missing steps, broken ordering/dependencies, absent acceptance criteria or validation, unhandled risks, internal contradictions, vague steps that force the implementer to guess.
   - If a finding is an open product decision (scope, cost, UX tradeoff, rollout policy), surface it to the user with up to two options and a recommendation instead of inventing an answer; record the decision in the plan once made.
   - If a finding is wrong, stale, or conflicts with the repository or higher-priority instructions, explain the decision in the main process. Ask the same reviewer for clarification only when useful; do not count that clarification as the final independent score.
   - If the reviewer gives a score below 9.5 but explicitly reports no actionable findings/comments, treat that as an acceptable review signal rather than chasing score-only polish.
   - If the reviewer gives a score below 9.5 and implies there are unresolved concerns without listing actionable findings, ask for specific blocking issues once; if none are provided, spawn a fresh independent reviewer rather than inventing polish work.

4. Validate after each meaningful revision.
   - Re-verify every factual claim added or changed in the plan against repository evidence (paths exist, schemas match, commands are real) before requesting another score.
   - Check internal consistency: step ordering, cross-references between sections, and agreement with the spec/TZ the plan implements.
   - Do not count a 9.5+ score or no-actionable-comments review as sufficient while the plan still contains unverified or contradictory claims you know about.

5. Repeat the loop.
   - Before spawning the next reviewer, print the score-trajectory table (see "Score Trajectory Report") and refresh the status-line round feed (see "Status-line Round Feed").
   - Spawn a new independent reviewer after revisions or after a reviewer cannot provide actionable issues. Each scoring pass must use a fresh sub-agent without parent context or prior review discussion.
   - Continue until the latest reviewer either scores the plan at least 9.5/10 or explicitly reports no actionable comments/findings, and no surfaced product decisions remain unanswered.
   - Exit early only if blocked by higher-priority instructions, missing tool capability, user interruption, or an open product decision the user must make first.

## Score Trajectory Report

- Maintain a running scoreboard across rounds. **As soon as the first round completes — and again before each subsequent round and once more in the Final Response — print exactly ONE summary table, written in the user's language and in plain, non-technical wording, with ONE row per completed round for the Claude/Opus reviewer.** Do NOT print an English table, and do NOT add any prose recap above or below the table: the table is the entire report.
- Translate the column headers into the user's language. The columns are:
  - Round — the round number.
  - Model — which reviewer this row is for: the Claude reviewer (label «Опус»). Render the model name in the user's language.
  - Score — the X/10 score the reviewer gave that round.
  - How serious the findings were — severity in plain words (critical / moderate / minor / none), never code terms.
  - Why we continue (or stop) — the plain-language reason tied to the findings (e.g. "found a serious error — fixing it" / "nothing left to fix").
- Translate every finding into plain terms a non-programmer understands (e.g. "the plan had a contradiction about how the feature reaches the live site", not "stale `file:line` claim"). Keep each cell to one short line.
- When a score dips, the "Why we continue" cell must make clear this is healthy: a real defect surfaced that earlier rounds had missed.
- Example (shown here in Russian — render it in the user's actual language):

| Раунд | Модель | Оценка | Насколько серьёзные находки | Почему продолжаем или стоп |
|-------|--------|--------|------------------------------|-----------------------------|
| 1 | Опус | 8,5 | Средние | Нашли неточности в плане — исправили |
| 2 | Опус | 9,5 | Нет | Замечаний больше нет — план готов, останавливаемся |

## Status-line Round Feed

Mirror the round scores into a small state file so the live Claude Code status line can show them while the loop runs. This is a side effect of the same moment you print the score-trajectory table — refresh it every time you print the table, and clear it in the Final Response. Keep it best-effort: never let a failure here block, delay, or alter the review loop.

- Key the file by the git repo root so scores never leak across projects and the key stays stable even if a review step `cd`s into a subdir like `webapp/` (this must match the status-line script's keying exactly; falls back to `$PWD` outside a git repo):
  `RF="$HOME/.claude/statusline-state/loop-review/$(printf '%s' "$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")" | sed 's#[^A-Za-z0-9]#_#g')"`
- After each completed round, write the running trajectory as one segment per round, joined by `;` (no spaces), latest last. Each segment is `<sev>:<score>`, where `<score>` is that round's score in the user's number format and `<sev>` mirrors the table's "How serious the findings were" column so the status line can color the number: `c` = critical/serious (red), `m` = moderate/medium (yellow), `s` = minor/small/cosmetic (green), `n` = none / no actionable findings (green). The line MUST start with `plan|`, and a score must never contain `:` or `;`:
  `mkdir -p "$(dirname "$RF")" && printf 'plan|%s\n' "m:8,5;n:9,5" > "$RF"`
  (e.g. after round 1 with moderate findings scored 8,5 write `plan|m:8,5`; after round 2 with no findings scored 9,5 write `plan|m:8,5;n:9,5`.)
- In the Final Response, remove it: `rm -f "$RF"`.

## Reviewer Prompt Template

Use a concise prompt like this, adjusted for the repository and the plan under review:

```text
Review the plan document at <plan-path> in this repository independently. You do not have parent conversation history; do not rely on any prior chat, parent-agent conclusions, or previous reviewer output. Derive your findings only from the documents and repository state you inspect yourself. Stay read-only: do not edit, stage, commit, reset, stash, or push files.

The plan implements <one-line goal>. Grounding sources: <spec/TZ path>, <data-model/docs paths>, and the code areas the plan references. Verify the plan's claims about the codebase yourself — referenced files, schemas, routes, APIs, and commands must actually exist and match.

Evaluate execution-readiness: could an implementer with repository access but no other context follow this plan step by step without guessing? Prioritize wrong or stale claims about the codebase, missing or misordered steps, absent acceptance criteria or validation strategy, unhandled risks and edge cases, internal contradictions, and steps too vague to act on. Flag open product decisions separately from actionable plan defects. Ignore stylistic preferences that do not change execution.

Return findings first, ordered by severity, each with a plan-section reference, supporting repository evidence, and a short explanation of how it would derail execution. If there are no actionable findings/comments, say that clearly. End with a numeric score from 1 to 10 for execution-readiness and explain what would be required to reach 9.5/10 if anything remains.
```

## Final Response

When the loop finishes, report:

- the final score-trajectory table (see "Score Trajectory Report"), in the user's language;
- what changed in the plan and why;
- the reviewer acceptance signal: score at least 9.5/10, no actionable comments/findings, or both;
- which factual claims were verified against the repository and how;
- product decisions the user made during the loop, and any still open;
- any findings intentionally not changed, with the reason;
- remaining risks or follow-up work, if any.

Also clear the status-line round feed: `rm -f "$RF"` (see "Status-line Round Feed").
