# Design notes — dsh-proactive-persona

Goal: a DeepSeek Harness plugin that **initiates conversation based on personality**.

Upstream: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) · [docs](https://deepseek-harness.github.io/deepseek-harness/)

## Problem

Harness is mostly user-initiated. This plugin adds agent-initiated speech with:

| Dimension | Target |
|-----------|--------|
| Initiator | Agent (not only user / schedule) |
| Timing | idle, clock, goal stall, webhook |
| Voice | configurable persona (traits / tone / topics) |
| Bounds | quiet hours, cooldown, daily cap, mute |

## Pipeline

```text
Trigger → Gate → Planner → Delivery → Memory
```

| Module | Role |
|--------|------|
| `signals` (in `index`) | idle / clock / goal-stall / external |
| `gate.ts` | quiet, cooldown, cap, initiative |
| `planner.ts` | LLM JSON `{speak,message,reason}` or template |
| `delivery.ts` | `inject` + `followup` + `sessions.flush` |
| `memory.ts` | dedupe + topic scores |

## Delivery (aligned with Harness Schedule)

```ts
// packages/schedule/schedule/src/runtime.ts pattern
resolved.agent.inject(continuity)
resolved.agent.followup(message)
await ctx.sessions.flush(resolved.agent.session)
```

## Personality consistency

1. `systemPrompt.section('proactive-persona:character')` — every turn
2. `characterBrief()` in LLM planner prompt — proactive lines
3. `agent.inject(buildContinuityText())` — thread continuity after openers

## Phases

- **P0** idle + template + gate + delivery
- **P1** LLM planner + clock rules + slash commands + character section
- **P2** goal stall + webhook external triggers
- **Not yet** UI sliders / history panel

## Safety

- Conservative defaults
- Speak-only (no privileged auto-tools)
- `/persona-quiet` mute
- No API keys in repo

## Harness API anchors

- `createUserMessage` — `@deepseek-ai/dsh-llm`
- `ctx.sessionController.resolveAgent`
- `agent.followup` / `agent.inject`
- `ctx.sessions.flush`
- `ctx.commands.register` — `CommandDefinitionId`, `CommandInvocation`, `CommandResult`
- `ctx.systemPrompt.section`
- `ctx.goals.get` — `GoalView.updatedAt`
- `ctx.webhookRuntime.register` (optional)

Harness is **developer preview** — re-check TypeScript surfaces in your checkout.
