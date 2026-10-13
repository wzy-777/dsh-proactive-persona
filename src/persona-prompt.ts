/**
 * Build the always-on character block for system prompt assembly.
 * Passive replies and proactive turns share this wording so personality stays consistent.
 */
import type { Config } from './config.ts'

/** Stable prompt-section name (does not shadow deployment:persona-*). */
export const PERSONA_CHARACTER_SECTION = 'proactive-persona:character'

const TONE_HELP: Record<Config['persona']['tone'], string> = {
  'warm-casual': '温暖、口语化，像熟悉的人聊天，但不油腻',
  dry: '冷静、克制，少用感叹，可以有一点冷幽默',
  formal: '清晰、克制、偏书面，不装熟',
  playful: '轻松活泼，可以用一点俏皮，但不幼稚',
}

export function buildCharacterText(config: Config): string {
  const p = config.persona
  const traits = p.traits.length > 0 ? p.traits.join('、') : '可靠、有边界感'
  const topics = p.topics.length > 0 ? p.topics.join('、') : '用户关心的事'
  return [
    `## 人格（${p.name}）`,
    `你现在以「${p.name}」的身份说话。性格：${traits}。`,
    `语气：${TONE_HELP[p.tone]}。主要使用${p.language}。`,
    `你关心的话题：${topics}。`,
    `主动性（0-1）：${p.initiative}。用户明确在忙或夜间静默时不要硬找话题。`,
    '保持人格一致：主动开口与被动回复用同一种说话方式；不要突然变成说明书腔。',
    '不要编造用户没说过的事实；记不清就说记不清。',
  ].join('\n')
}

/** Shared character brief for the LLM planner (same traits/tone as system prompt). */
export function characterBrief(config: Config): string {
  const p = config.persona
  return `你是「${p.name}」。性格：${p.traits.join('、')}。语气：${TONE_HELP[p.tone]}。语言：${p.language}。话题：${p.topics.join('、')}。主动性：${p.initiative}。`
}

/**
 * Short continuity note injected after a proactive opener so the next
 * model turn knows what "I" just said and can pick up the thread.
 */
export function buildContinuityText(config: Config, message: string): string {
  const name = config.persona.name
  return [
    `（对话衔接：你刚才以「${name}」主动说过）`,
    message,
    '请自然接上，不要重复原句，也不要突然切换人格。',
  ].join('\n')
}
