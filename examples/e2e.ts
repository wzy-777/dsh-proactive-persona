/**
 * E2E pipeline checks (mock context, no external API).
 *
 * Run (cwd = deepseek-harness-master):
 *   node --import tsx/esm ../dsh-proactive-persona/examples/e2e.ts
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const plugin = await import(pathToFileURL(path.join(root, 'src/index.ts')).href)
const { createGateState, evaluateGate, muteFor } = await import(
  pathToFileURL(path.join(root, 'src/gate.ts')).href
)
const { planMessage } = await import(pathToFileURL(path.join(root, 'src/persona.ts')).href)
const { buildCharacterText, buildContinuityText } = await import(
  pathToFileURL(path.join(root, 'src/persona-prompt.ts')).href
)

type UserMsg = { id: string; content: Array<{ type: string; text: string }>; source: { kind: string } }

const followups: UserMsg[] = []
const injects: UserMsg[] = []
const flushes: string[] = []
const sections: string[] = []
const commandHandlers = new Map<string, (inv: { rawInput: string }) => { kind: string; text?: string }>()
const logs: string[] = []

const agent = {
  id: 'sess-e2e-1',
  session: { id: 'sess-e2e-1' },
  followup: (m: UserMsg) => { followups.push(m) },
  inject: (m: UserMsg) => { injects.push(m) },
}

const systemPrompt = {
  section(s: { name: string; text: string | (() => string) }) {
    sections.push(typeof s.text === 'function' ? s.text() : s.text)
    return () => {}
  },
  getSectionOrder: () => 10,
}

const ctx = {
  get: (k: string) => (k === 'systemPrompt' ? systemPrompt : undefined),
  effect(fn: () => unknown) {
    const r = fn()
    if (typeof r === 'function') return r
    if (r && typeof (r as Generator)[Symbol.iterator] === 'function') {
      for (const y of r as Generator) void y
    }
    return () => {}
  },
  on: () => () => {},
  logger: {
    info: (m: string) => logs.push(`INFO ${m}`),
    warn: (m: string) => logs.push(`WARN ${m}`),
    debug: (m: string) => logs.push(`DEBUG ${m}`),
  },
  agents: { list: () => [agent] },
  sessions: {
    flush: async () => { flushes.push('sess-e2e-1'); return true },
  },
  sessionController: { resolveAgent: async () => ({ agent }) },
  commands: {
    register(def: {
      name: string
      handler: (inv: { rawInput: string }) => { kind: string; text?: string }
    }) {
      commandHandlers.set(def.name, def.handler)
      return () => {}
    },
    execute: async (_a: unknown, name: string, rawInput = '') => {
      const h = commandHandlers.get(name.replace(/^\//, ''))
      if (!h) return { kind: 'error', text: 'unknown command' }
      return h({ rawInput })
    },
  },
}

const config = {
  persona: {
    name: 'A-Shen',
    traits: ['curious', 'caring'],
    tone: 'warm-casual' as const,
    language: 'zh-CN',
    initiative: 0.9,
    topics: ['engineering progress'],
    openers: ['Want to chat about {topic}, {name} is here.'],
  },
  policy: {
    quietHours: [] as string[],
    minIntervalMinutes: 0,
    maxPerDay: 100,
    respectFocus: false,
  },
  triggers: {
    idleMinutes: 1,
    tickSeconds: 3600,
    clockRules: [] as string[],
    goalStallMinutes: 0,
    externalEnabled: false,
    externalKind: 'proactive-signal',
  },
  planner: {
    enabled: false,
    baseUrl: '',
    apiKey: '',
    model: 'm',
    temperature: 0.7,
    maxTokens: 128,
  },
}

console.log('=== E2E dsh-proactive-persona ===')

const character = buildCharacterText(config)
console.log('character-ok', character.includes('A-Shen'))
const continuity = buildContinuityText(config, 'hello')
console.log('continuity-ok', continuity.includes('hello'))

plugin.apply(ctx as never, config as never)
console.log('commands', [...commandHandlers.keys()])

const talkResult = await ctx.commands.execute(null, '/persona-talk')
console.log('talk-result', talkResult)
await new Promise(r => setTimeout(r, 30))

console.log('followups', followups.map(m => m.content[0]?.text))
console.log('injects', injects.map(m => (m.content[0]?.text ?? '').slice(0, 40)))
console.log('flushes', flushes)

const okSection = sections.length > 0
const okCmds = ['persona-quiet', 'persona-talk', 'persona-unmute', 'persona-status'].every(n =>
  commandHandlers.has(n),
)
const okTalk = followups.length === 1
const okInject = injects.length >= 1
const okFlush = flushes.length >= 1

const quietRes = await ctx.commands.execute(null, '/persona-quiet', '30')
const gate = createGateState()
muteFor(gate, 30)
const muted = evaluateGate(config, gate, { signalKind: 'idle' })
console.log('quiet', quietRes, 'muted', muted)
const okQuiet = (quietRes as { kind: string }).kind === 'success' && !muted.allow

const plan = planMessage(config, { signalKind: 'idle', topic: 'engineering progress' })
console.log('plan', plan)
const okPlan = plan.speak && plan.message.length > 0

const result = { okSection, okCmds, okTalk, okInject, okFlush, okQuiet, okPlan }
console.log('E2E_RESULT', JSON.stringify(result))
if (!Object.values(result).every(Boolean)) process.exitCode = 1
process.exit(process.exitCode ?? 0)
