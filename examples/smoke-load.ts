/**
 * Smoke: load dsh-proactive-persona against a minimal mock Context.
 * Verifies apply() registers character section + commands.
 *
 * Run (cwd = deepseek-harness-master):
 *   node --import tsx/esm ../dsh-proactive-persona/examples/smoke-load.ts
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginPath = path.resolve(__dirname, '../src/index.ts')
const mod = await import(pathToFileURL(pluginPath).href)

const sections: Array<{ name: string; order: number; text: string }> = []
const registered: Array<{ name: string; description: string }> = []
const logs: string[] = []

const systemPrompt = {
  section(s: { name: string; order: number; text: string | (() => string) }) {
    sections.push({ ...s, text: typeof s.text === 'function' ? s.text() : s.text })
    return () => {}
  },
  getSectionOrder: () => 10,
}

const ctx = {
  get(key: string) {
    if (key === 'systemPrompt') return systemPrompt
    return undefined
  },
  effect(fn: () => unknown, _label?: string) {
    const result = fn()
    if (typeof result === 'function') return result
    if (result && typeof (result as Generator)[Symbol.iterator] === 'function') {
      for (const step of result as Generator) {
        void step
      }
    }
    return () => {}
  },
  on() {
    return () => {}
  },
  logger: {
    info: (m: string) => logs.push(`INFO ${m}`),
    warn: (m: string) => logs.push(`WARN ${m}`),
    debug: (m: string) => logs.push(`DEBUG ${m}`),
  },
  agents: { list: () => [] },
  sessions: { flush: async () => true },
  sessionController: { resolveAgent: async () => ({ error: 'no-agent' }) },
  commands: {
    register(def: { name: string; description: string }) {
      registered.push({ name: def.name, description: def.description })
      return () => {}
    },
  },
}

const config = {
  persona: {
    name: 'A-Shen',
    traits: ['curious', 'caring'],
    tone: 'warm-casual' as const,
    language: 'zh-CN',
    initiative: 0.65,
    topics: ['engineering'],
    openers: ['Want to talk about {topic}?'],
  },
  policy: {
    quietHours: ['23:00-08:00'],
    minIntervalMinutes: 45,
    maxPerDay: 6,
    respectFocus: true,
  },
  triggers: {
    idleMinutes: 30,
    tickSeconds: 60,
    clockRules: [] as string[],
    goalStallMinutes: 0,
    externalEnabled: false,
    externalKind: 'x',
  },
  planner: {
    enabled: false,
    baseUrl: '',
    apiKey: '',
    model: 'm',
    temperature: 0.8,
    maxTokens: 64,
  },
}

console.log('plugin-exports', {
  name: mod.name,
  hasApply: typeof mod.apply === 'function',
  inject: mod.inject,
})

mod.apply(ctx as never, config as never)

console.log('sections', sections.map(s => s.name))
console.log('commands', registered.map(r => r.name))
console.log('logs', logs)

const okName = mod.name === 'dsh-proactive-persona'
const okSection = sections.some(s => s.name === 'proactive-persona:character')
const okCmds = ['persona-quiet', 'persona-talk', 'persona-unmute', 'persona-status'].every(n =>
  registered.some(r => r.name === n),
)

console.log('SMOKE_RESULT', JSON.stringify({ okName, okSection, okCmds }))
if (!(okName && okSection && okCmds)) process.exitCode = 1
process.exit(process.exitCode ?? 0)
