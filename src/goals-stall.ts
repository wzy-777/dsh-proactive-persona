/**
 * Goal-stall follow-up (P2): nudge when an active/blocked goal goes quiet.
 * Uses ctx.goals.get(agent) — GoalView has phase + updatedAt + objective.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

export interface GoalStallSignal {
  kind: 'goal-stall'
  sessionId: string
  agent: Agent
  objective: string
  phase: string
  stalledMs: number
  roundsStarted: number
}

/** Collect goals that have not been updated within `stallMinutes`. */
export function collectGoalStalls(
  ctx: Context,
  stallMinutes: number,
  now = Date.now(),
): GoalStallSignal[] {
  if (stallMinutes <= 0) return []
  const goals = ctx.get('goals')
  if (!goals) return []

  const out: GoalStallSignal[] = []
  const threshold = stallMinutes * 60_000

  for (const agent of ctx.agents.list()) {
    let view
    try {
      view = goals.get(agent)
    } catch {
      continue
    }
    if (!view) continue
    if (view.phase !== 'active' && view.phase !== 'blocked') continue

    const stalledMs = now - view.updatedAt
    if (stalledMs < threshold) continue

    out.push({
      kind: 'goal-stall',
      sessionId: String(agent.session?.id ?? agent.id),
      agent,
      objective: view.objective,
      phase: view.phase,
      stalledMs,
      roundsStarted: view.roundsStarted,
    })
  }
  return out
}

/** Turn a stall into planner input. */
export function goalStallPlanInput(sig: GoalStallSignal): {
  signalKind: string
  topic?: string
  lastUserText?: string
} {
  return {
    signalKind: `goal-stall:${sig.phase}`,
    topic: `目标「${sig.objective.slice(0, 40)}」`,
    lastUserText: `目标停留了约 ${Math.round(sig.stalledMs / 60000)} 分钟（phase=${sig.phase}）`,
  }
}
