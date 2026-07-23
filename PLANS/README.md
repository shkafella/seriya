# Папка PLANS — планы фич проекта

Здесь живут планы всех непростых задач. Правило из CLAUDE.md: перед сложной работой ИИ предлагает написать план; одобренный план сохраняется сюда, проходит `/loop-plan-review` и только потом начинается код.

Планы **не удаляются** после выполнения. Папка накапливает историю решений проекта: через месяц всегда можно поднять, почему сделали именно так, и не перерешивать заново.

## Правила

- Все документы в этой папке — планы, ТЗ, спецификации — всегда пишутся **на английском языке**. Обсуждение планов с владельцем при этом идёт на русском, как обычно.
- Один план — один файл. Имя: `FEATURE_NAME_PLAN.md` (например `PAYMENTS_PLAN.md`, `NOTIFICATIONS_PLAN.md`).
- План пишется простым языком: владелец проекта должен понимать каждый пункт. Технические детали — только там, где без них решение нельзя зафиксировать.
- Ключевые решения нумеруются `D-1`, `D-2`, … — на них удобно ссылаться в разговоре и в следующих планах («как решили в D-3»). Если решение меняется, старое не стирается, а помечается: `D-3 (пересмотрено, см. D-7)`.
- После одобрения структуры плана владельцем прогоняется `/loop-plan-review` — независимый проверяющий крутит раунды замечаний, пока план не станет готовым к исполнению (оценка ≥ 9,5/10 или «замечаний нет»).
- По ходу реализации план дополняется пометками о фактическом статусе этапов.

## Шаблон плана

```markdown
# Plan: <feature name>

## What and why
2–5 sentences: what user problem we solve, what appears on screen,
and how we will know the feature succeeded.

## Key decisions
- **D-1.** <Decision and a short "why". Rejected alternatives — one line.>
- **D-2.** …

## What we deliberately do NOT do
Feature boundaries: what we postpone and why. This protects against scope creep.

## Stages
### Stage 1 — <name>
- What gets done.
- **Done when:** <observable criteria — what is visible on screen / what the
  server responds / which tests are green>.

### Stage 2 — <name>
- …

## Risks and open questions
- <What can go wrong, what to clarify with the owner.>

## Status
- [ ] Plan approved by the owner
- [ ] Plan passed /loop-plan-review
- [ ] Stage 1 … / Stage 2 … (check off as work proceeds)
- [ ] Code passed /loop-code-review (for complex features)
```
