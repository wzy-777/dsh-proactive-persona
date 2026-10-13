/**
 * dsh-proactive-persona
 * Agent autonomy plugin: initiate conversation based on personality.
 *
 * P1 scope (builds on P0):
 *  - idle + daily clock triggers
 *  - gate (quiet hours, cooldown, daily cap, initiative)
 *  - LLM planner (OpenAI-compatible) with template fallback
 *  - deliver via agent.followup() into Session inbox
 *  - real /persona-quiet /persona-talk /persona-unmute /persona-status commands
 */
import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Config } from './config.ts'
import { Config as ConfigSchema } from './config.ts'
import {
  createGateState,
  evaluateGate,
  markSpoke,
  muteFor,
  unmute,
  type GateState,
} from './gate.ts'
import { planWithLlm, type PlanResult } from './planner.ts'
import { deliverFollowup } from './delivery.ts'
import {
  createMemory,
  hashMessage,
  rankTopics,
  recentlySaid,
  recordSent,
  type Memory,
} from './memory.ts'
import { PERSONA_CHARACTER_SECTION, buildCharacterText } from './persona-prompt.ts'
import { collectGoalStalls, goalStallPlanInput } from './goals-stall.ts'
import { registerExternalTrigger, externalPlanInput, type ExternalSignal } from './external.ts'

export const name = 'dsh-proactive-persona'
export const inject = ['agents', 'sessions', 'sessionController', 'commands', 'systemPrompt']
export { ConfigSchema as Config }

interface SessionClock {
  sessionId: string
  lastActivityAt: number
  busy: boolean
}

export function apply(ctx: Context, config: Config) {
  const gate: GateState = createGateState()
  const memory: Memory = createMemory()
  const clocks = new Map<string, SessionClock>()
  /** Local-time clock rules already fired today (HH:MM keys). */
  const firedClock = new Set<string>()

  // --- personality consistency: always-on system prompt character ---
  // Unique section name so we don't shadow deployment:persona-*.
  // Order 10 sits just after DEPLOYMENT_PERSONA_PREFIX (0), before PLAN_POLICY (500).
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({
      name: PERSONA_CHARACTER_SECTION,
      order: 10,
      text: buildCharacterText(config),
    }))
  } else {
    ctx.logger.warn('[proactive-persona] systemPrompt service absent; character section skipped')
  }

  function pickTargetSession(prefer?: string): string | null {
    if (prefer) return prefer
    let best: SessionClock | null = null
    for (const c of clocks.values()) {
      if (!best || c.lastActivityAt > best.lastActivityAt) best = c
    }
    if (best) return best.sessionId
    // Fallback: any live agent/session (e.g. right after boot, before activity).
    try {
      const first = ctx.agents.list()[0]
      if (first) return String((first as { session?: { id?: string }; id?: string }).session?.id ?? (first as { id?: string }).id ?? '')
    } catch { /* ignore */ }
    return null
  }

  function touch(sessionId: string, busy?: boolean): void {
    const now = Date.now()
    const cur = clocks.get(sessionId) ?? { sessionId, lastActivityAt: now, busy: false }
    cur.lastActivityAt = now
    if (busy !== undefined) cur.busy = busy
    clocks.set(sessionId, cur)
  }

  ctx.on('session/event', (event: { sessionId?: string; type?: string }) => {
    const sid = event.sessionId
    if (!sid) return
    touch(sid, event.type === 'user/message' ? false : true)
    if (event.type === 'user/message') {
      const t = setTimeout(() => touch(sid, false), 5_000)
      t.unref?.()
    }
  })

  ctx.effect(() => {
    const timer = setInterval(() => { void tick() }, config.triggers.tickSeconds * 1000)
    return () => clearInterval(timer)
  })

  // External webhook signals (optional).
  let pendingExternal: ExternalSignal | null = null
  const disposeExternal = registerExternalTrigger(ctx, config, (sig) => {
    pendingExternal = sig
    void handleExternal(sig)
  })
  if (disposeExternal) {
    ctx.effect(() => { void disposeExternal() })
  }

  async function handleExternal(sig: ExternalSignal): Promise<void> {
    const sessionId = pickTargetSession()
    if (!sessionId) return
    const planInput = externalPlanInput(sig)
    const topics = rankTopics(memory, config.persona.topics)
    const decision = evaluateGate(config, gate, {
      signalKind: planInput.signalKind,
      topic: planInput.topic ?? topics[0],
      forceInitiative: true,
    })
    if (!decision.allow) {
      ctx.logger.debug?.(`[proactive-persona] external skip: ${decision.reason}`)
      return
    }

    const plan = await planWithLlm(config, planInput)
    if (plan.speak && plan.message) {
      await send(sessionId, plan, planInput.signalKind, planInput.topic ?? '')
    }
    pendingExternal = null
  }

  function clockDue(now = new Date()): string | null {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    for (const rule of config.triggers.clockRules) {
      const key = `${rule.trim()}|${hhmm}`
      if (rule.trim() === hhmm && !firedClock.has(key)) {
        firedClock.add(key)
        return rule.trim()
      }
    }
    // Reset fired set when the day changes (cheap: clear if empty slots unlikely).
    if (now.getHours() === 0 && now.getMinutes() === 0) firedClock.clear()
    return null
  }

  async function tick(): Promise<void> {
    const now = new Date()
    const clockHit = clockDue(now)

    // Goal stall takes priority: more specific than idle.
    const stalls = collectGoalStalls(ctx, config.triggers.goalStallMinutes, now.getTime())
    if (stalls.length > 0) {
      const stall = stalls[0]!
      const planInput = goalStallPlanInput(stall)
      const topics = rankTopics(memory, config.persona.topics)
      const decision = evaluateGate(config, gate, {
        signalKind: planInput.signalKind,
        topic: planInput.topic ?? topics[0],
        forceInitiative: true,
      })
      if (decision.allow) {
        const plan = await planWithLlm(config, planInput)
        if (plan.speak && plan.message) {
          await send(stall.sessionId, plan, planInput.signalKind, planInput.topic ?? '')
          return
        }
      }
    }

    const sessionId = pickTargetSession()
    if (!sessionId && !clockHit) return

    const clock = clocks.get(sessionId ?? '')
    const idleMs = clock ? Date.now() - clock.lastActivityAt : Number.POSITIVE_INFINITY
    const idleThreshold = config.triggers.idleMinutes * 60_000

    let signalKind: string | null = null
    if (clockHit) signalKind = `clock:${clockHit}`
    else if (idleMs >= idleThreshold) signalKind = 'idle'
    if (!signalKind || !sessionId) return

    const topics = rankTopics(memory, config.persona.topics)
    const decision = evaluateGate(config, gate, {
      signalKind,
      idleMs,
      busy: clock?.busy ?? false,
      topic: topics[0],
      forceInitiative: signalKind.startsWith('clock:'),
    })
    if (!decision.allow) {
      ctx.logger.debug?.(`[proactive-persona] skip: ${decision.reason}`)
      return
    }

    const plan = await planWithLlm(config, {
      signalKind,
      topic: topics[0],
    })
    if (!plan.speak || !plan.message) return

    const messageHash = hashMessage(plan.message)
    if (recentlySaid(memory, messageHash)) {
      const alt = await planWithLlm(config, { signalKind, topic: topics[1] ?? topics[0] })
      if (!alt.speak || recentlySaid(memory, hashMessage(alt.message))) return
      return send(sessionId, alt, signalKind, topics[1] ?? topics[0] ?? '')
    }

    await send(sessionId, plan, signalKind, topics[0] ?? '')
  }

  async function send(
    sessionId: string,
    plan: Pick<PlanResult, 'message' | 'reason'>,
    signalKind: string,
    topic: string,
  ): Promise<void> {
    const result = await deliverFollowup(ctx, config, sessionId, plan.message)
    if (!result.ok) {
      ctx.logger.warn(`[proactive-persona] delivery failed: ${result.error}`)
      return
    }
    markSpoke(gate)
    recordSent(memory, {
      at: Date.now(),
      signalKind,
      topic,
      messageHash: hashMessage(plan.message),
    })
    ctx.logger.info(`[proactive-persona] spoke (${plan.reason}): ${plan.message}`)
  }

  // --- human commands (real ctx.commands registry) ---

  const ok = (text: string): CommandResult => ({ kind: 'success', text })
  const err = (text: string): CommandResult => ({ kind: 'error', text })

  ctx.effect(function* () {
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('dsh-proactive-persona/quiet'),
      name: 'persona-quiet',
      description: '让主动人格安静一段时间（分钟，默认 120）',
      handler: (inv: CommandInvocation): CommandResult => {
        const n = Number(inv.rawInput.trim()) || 120
        muteFor(gate, n)
        return ok(`好，我先安静 ${n} 分钟。`)
      },
    })

    yield ctx.commands.register({
      definitionId: CommandDefinitionId('dsh-proactive-persona/talk'),
      name: 'persona-talk',
      description: '立刻主动说一句（可选参数：session id）',
      handler: (inv: CommandInvocation): CommandResult => {
        const sid = pickTargetSession(inv.rawInput.trim() || undefined)
        if (!sid) return err('当前没有可用会话。')
        void (async () => {
          const topics = rankTopics(memory, config.persona.topics)
          const plan = await planWithLlm(config, { signalKind: 'manual', topic: topics[0] })
          if (plan.speak && plan.message) {
            await send(sid, plan, 'manual', topics[0] ?? '')
          }
        })()
        return ok(`好，我这就去 ${sid} 说一句。`)
      },
    })

    yield ctx.commands.register({
      definitionId: CommandDefinitionId('dsh-proactive-persona/unmute'),
      name: 'persona-unmute',
      description: '解除主动人格静默',
      handler: (): CommandResult => {
        unmute(gate)
        return ok('我回来了。')
      },
    })

    yield ctx.commands.register({
      definitionId: CommandDefinitionId('dsh-proactive-persona/status'),
      name: 'persona-status',
      description: '查看主动人格状态',
      handler: (): CommandResult =>
        ok(JSON.stringify({
          persona: config.persona.name,
          lastSpokeAt: gate.lastSpokeAt,
          spokeCountToday: gate.spokeCountToday,
          mutedUntil: gate.mutedUntil,
          sessions: clocks.size,
          planner: config.planner.enabled ? config.planner.model : 'template',
        }, null, 2)),
    })
  }, 'dsh-proactive-persona commands')

  ctx.logger.info(
    `[proactive-persona] loaded name=${config.persona.name} idle=${config.triggers.idleMinutes}m initiative=${config.persona.initiative} planner=${config.planner.enabled ? config.planner.model : 'template'}`,
  )
}

export default { name, inject, apply, Config: ConfigSchema }
