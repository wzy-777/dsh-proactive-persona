/**
 * P1 planner: optional LLM call (OpenAI-compatible) with template fallback.
 * Keeps the same PlanResult shape as the P0 template planner.
 */
import type { Config } from './config.ts'
import { planMessage as templatePlan, type PlanInput, type PlanResult } from './persona.ts'
import { characterBrief } from './persona-prompt.ts'

export type { PlanInput, PlanResult }

export interface PlannerContext {
  lastUserText?: string
  recentSummary?: string
}

/**
 * Try LLM planning first; fall back to templates on any failure or non-JSON.
 */
export async function planWithLlm(
  config: Config,
  input: PlanInput,
  extra: PlannerContext = {},
): Promise<PlanResult> {
  const planner = config.planner
  if (!planner.enabled || !planner.apiKey || !planner.baseUrl) {
    return templatePlan(config, input)
  }

  try {
    const raw = await completeText(config, buildPrompt(config, input, extra))
    const parsed = parsePlanJson(raw)
    if (parsed) return parsed
    return templatePlan(config, input)
  } catch {
    return templatePlan(config, input)
  }
}

function buildPrompt(config: Config, input: PlanInput, extra: PlannerContext): string {
  const { persona } = config
  return [
    characterBrief(config),
    extra.recentSummary ? `最近对话摘要：${extra.recentSummary}` : '',
    extra.lastUserText ? `用户最近说过：${extra.lastUserText.slice(0, 200)}` : '',
    `触发信号：${input.signalKind}${input.topic ? `，话题倾向：${input.topic}` : ''}。`,
    '请决定是否主动开口，并用符合性格的短句发言。不要装可爱，不要重复套话，不要用列表。',
    '只输出 JSON：{"speak":true|false,"message":"...","reason":"..."}',
  ].filter(Boolean).join('\n')
}

function parsePlanJson(raw: string): PlanResult | null {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      speak?: boolean
      message?: string
      reason?: string
    }
    if (typeof obj.speak !== 'boolean') return null
    if (obj.speak && (typeof obj.message !== 'string' || obj.message.trim().length === 0)) {
      return null
    }
    return {
      speak: obj.speak,
      message: obj.message?.trim() ?? '',
      reason: obj.reason ?? 'llm',
    }
  } catch {
    return null
  }
}

/** Minimal OpenAI-compatible chat completion (non-stream). */
async function completeText(config: Config, userPrompt: string): Promise<string> {
  const { planner } = config
  const url = `${planner.baseUrl.replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${planner.apiKey}`,
    },
    body: JSON.stringify({
      model: planner.model,
      temperature: planner.temperature,
      max_tokens: planner.maxTokens,
      messages: [
        { role: 'system', content: '你是一个有性格的对话同伴，只输出 JSON。' },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`planner http ${res.status}`)
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('planner empty')
  return text
}
