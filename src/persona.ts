/**
 * Persona planner (P0): template fill only.
 * P1 will add an LLM planner behind the same PlanResult shape.
 */
import type { Config } from './config.ts'

export interface PlanInput {
  signalKind: string
  topic?: string
  lastUserText?: string
}

export interface PlanResult {
  speak: boolean
  message: string
  reason: string
}

const TONE_PREFIX: Record<Config['persona']['tone'], string> = {
  'warm-casual': '',
  dry: '（冷静）',
  formal: '',
  playful: '～',
}

export function planMessage(config: Config, input: PlanInput): PlanResult {
  const { persona } = config
  const topic = input.topic ?? pickTopic(persona.topics, input.signalKind)
  const opener = persona.openers[Math.floor(Math.random() * Math.max(persona.openers.length, 1))]
    ?? `{name}：要不要聊聊 {topic}？`

  const text = opener
    .replaceAll('{name}', persona.name)
    .replaceAll('{topic}', topic)
    .replaceAll('{signal}', input.signalKind)

  const suffix = TONE_PREFIX[persona.tone]
  const message = suffix && persona.tone === 'playful' ? `${text}${suffix}` : text

  return {
    speak: true,
    message,
    reason: `template:${input.signalKind}:${topic}`,
  }
}

function pickTopic(topics: string[], signalKind: string): string {
  if (topics.length === 0) return '最近的事'
  // Prefer a stable pick so consecutive idle pings don't thrash topics wildly.
  const idx = Math.abs(hashString(signalKind)) % topics.length
  return topics[idx]!
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
