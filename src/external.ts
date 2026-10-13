/**
 * External triggers (P2): optional WebhookRuntime rule.
 * Trusted rule can run arbitrary code; returning null skips Session creation
 * so we can feed the proactive pipeline instead of opening a new chat.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'

export interface ExternalSignal {
  kind: 'external'
  source: string
  deliveryId: string
  topic?: string
  summary?: string
}

type WebhookRuntimeLike = {
  register(rule: {
    id: string
    kind: string
    run: (
      delivery: { kind: string; source: string; deliveryId: string; event: unknown; receivedAt: number },
      signal: AbortSignal,
    ) => null | Promise<null>
  }): () => Promise<void>
}

/**
 * Register a webhook rule that turns external deliveries into proactive signals.
 * Returns a disposer, or null when webhookRuntime is absent / disabled.
 */
export function registerExternalTrigger(
  ctx: Context,
  config: Config,
  onSignal: (sig: ExternalSignal) => void,
): (() => Promise<void>) | null {
  if (!config.triggers.externalEnabled) return null
  const runtime = ctx.get('webhookRuntime') as WebhookRuntimeLike | undefined
  if (!runtime) {
    ctx.logger.warn('[proactive-persona] webhookRuntime absent; external triggers disabled')
    return null
  }

  const kind = config.triggers.externalKind
  const dispose = runtime.register({
    id: 'proactive-persona/external',
    kind,
    run: (delivery, signal) => {
      if (signal.aborted) return null
      const event = delivery.event as Record<string, unknown> | null | undefined
      const topic = typeof event?.topic === 'string' ? event.topic : undefined
      const summary = typeof event?.summary === 'string'
        ? event.summary
        : typeof event?.message === 'string'
          ? event.message
          : undefined

      onSignal({
        kind: 'external',
        source: delivery.source,
        deliveryId: delivery.deliveryId,
        topic,
        summary,
      })
      // No Session request — proactive pipeline owns delivery.
      return null
    },
  })

  return dispose
}

export function externalPlanInput(sig: ExternalSignal): {
  signalKind: string
  topic?: string
  lastUserText?: string
} {
  return {
    signalKind: `external:${sig.source}`,
    topic: sig.topic ?? '刚发生的外部事件',
    lastUserText: sig.summary,
  }
}
