/**
 * Delivery: queue a proactive message into a Session inbox via agent.followup().
 * Pattern mirrors packages/schedule/schedule/src/runtime.ts.
 * Also injects a short continuity note so the next turn stays in character.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { buildContinuityText } from './persona-prompt.ts'
import type { Config } from './config.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'proactive-persona': { kind: 'proactive-persona' } & ContextFormed
  }
}

export interface DeliveryResult {
  ok: boolean
  sessionId: string
  messageId?: string
  error?: string
}

export async function deliverFollowup(
  ctx: Context,
  config: Config,
  sessionId: SessionId | string,
  text: string,
): Promise<DeliveryResult> {
  const resolved = await ctx.sessionController.resolveAgent(sessionId as SessionId)
  if ('error' in resolved) {
    return { ok: false, sessionId: String(sessionId), error: String(resolved.error) }
  }

  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'proactive-persona' },
  })

  // Continuity for the model: "you just opened with this" — keeps character stable.
  const continuity = createUserMessage({
    content: [{ type: 'text', text: buildContinuityText(config, text) }],
    source: { kind: 'proactive-persona' },
  })

  // inject lands as context for the next admitted request; followup wakes the driver.
  resolved.agent.inject(continuity)
  resolved.agent.followup(message)

  const flushed = await ctx.sessions.flush(resolved.agent.session)
  if (!flushed) {
    return { ok: false, sessionId: String(sessionId), error: 'session-persistence-not-acked' }
  }

  return { ok: true, sessionId: String(sessionId), messageId: message.id }
}
