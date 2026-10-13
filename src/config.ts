/**
 * Personality + policy configuration for dsh-proactive-persona.
 * All tunable values are config fields (Harness convention).
 */
import z from '@deepseek-ai/schemastery'

export interface PersonaConfig {
  name: string
  traits: string[]
  tone: 'warm-casual' | 'dry' | 'formal' | 'playful'
  language: string
  /** 0 = almost never initiates, 1 = very chatty. */
  initiative: number
  topics: string[]
  openers: string[]
}

export interface PolicyConfig {
  /** e.g. ['23:00-08:00'] in local time. */
  quietHours: string[]
  minIntervalMinutes: number
  maxPerDay: number
  respectFocus: boolean
}

export interface TriggerConfig {
  idleMinutes: number
  tickSeconds: number
  /** Local-time daily greetings, e.g. ['09:10', '21:30'] */
  clockRules: string[]
  /** Nudge when a goal has been idle this long (minutes). 0 disables. */
  goalStallMinutes: number
  /** Accept external webhook signals as proactive triggers. */
  externalEnabled: boolean
  /** Webhook provider kind this plugin listens for (e.g. 'proactive-signal'). */
  externalKind: string
}

export interface PlannerConfig {
  enabled: boolean
  /** OpenAI-compatible API root, e.g. https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface Config {
  persona: PersonaConfig
  policy: PolicyConfig
  triggers: TriggerConfig
  planner: PlannerConfig
}

export const Config: z<Config> = z.object({
  persona: z.object({
    name: z.string().default('阿深'),
    traits: z.array(z.string()).default(['好奇', '体贴', '记得你说过的事']),
    tone: z.union(['warm-casual', 'dry', 'formal', 'playful']).default('warm-casual'),
    language: z.string().default('zh-CN'),
    initiative: z.number().min(0).max(1).default(0.5),
    topics: z.array(z.string()).default(['工程进展', '效率', '最近在做的事']),
    openers: z.array(z.string()).default([
      '刚才这边有点空，要不要聊聊 {topic}？',
      '{name}路过：最近 {topic} 还顺利吗？',
      '想起你说过的事——{topic} 后来怎么样了？',
    ]),
  }),
  policy: z.object({
    quietHours: z.array(z.string()).default(['23:00-08:00']),
    minIntervalMinutes: z.number().min(1).default(45),
    maxPerDay: z.number().min(1).default(6),
    respectFocus: z.boolean().default(true),
  }),
  triggers: z.object({
    idleMinutes: z.number().min(1).default(30),
    tickSeconds: z.number().min(10).default(60),
    clockRules: z.array(z.string()).default(['09:10', '21:30']),
    goalStallMinutes: z.number().min(0).default(90),
    externalEnabled: z.boolean().default(false),
    externalKind: z.string().default('proactive-signal'),
  }),
  planner: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().default(''),
    apiKey: z.string().default(''),
    model: z.string().default('deepseek-chat'),
    temperature: z.number().min(0).max(2).default(0.8),
    maxTokens: z.number().min(16).max(2048).default(256),
  }),
})
