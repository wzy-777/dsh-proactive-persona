/**
 * Real DeepSeek API planner check.
 * Reads DEEPSEEK_API_KEY from the environment — never hardcode keys.
 *
 * Run (cwd = deepseek-harness-master):
 *   $env:DEEPSEEK_API_KEY = '...'
 *   node --import tsx/esm ../dsh-proactive-persona/examples/e2e-deepseek.ts
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const { planWithLlm } = await import(pathToFileURL(path.join(root, 'src/planner.ts')).href)
const { buildCharacterText } = await import(pathToFileURL(path.join(root, 'src/persona-prompt.ts')).href)

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('Set DEEPSEEK_API_KEY first')
  process.exit(1)
}

function cfg(name: string, tone: 'warm-casual' | 'dry' | 'formal' | 'playful', traits: string[], topics: string[]) {
  return {
    persona: { name, traits, tone, language: 'zh-CN', initiative: 0.8, topics, openers: [] },
    policy: { quietHours: [], minIntervalMinutes: 0, maxPerDay: 50, respectFocus: false },
    triggers: {
      idleMinutes: 5,
      tickSeconds: 60,
      clockRules: [],
      goalStallMinutes: 0,
      externalEnabled: false,
      externalKind: 'x',
    },
    planner: {
      enabled: true,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey,
      model: 'deepseek-chat',
      temperature: 0.85,
      maxTokens: 200,
    },
  }
}

const scenarios = [
  {
    label: 'warm idle',
    config: cfg('阿深', 'warm-casual', ['好奇', '体贴', '记得你说过的事'], ['工程进展', '读书']),
    input: { signalKind: 'idle', topic: '工程进展' },
  },
  {
    label: 'dry goal-stall',
    config: cfg('阿深', 'dry', ['冷静', '克制', '偶尔毒舌'], ['架构评审', '重构']),
    input: { signalKind: 'goal-stall:active', topic: '架构评审' },
  },
  {
    label: 'playful external',
    config: cfg('阿深', 'playful', ['轻松', '爱接梗', '好奇'], ['新玩具', '周末计划']),
    input: { signalKind: 'external:calendar', topic: '新玩具' },
  },
  {
    label: 'formal clock',
    config: cfg('阿深', 'formal', ['可靠', '清晰', '有条理'], ['今日计划', '周报']),
    input: { signalKind: 'clock:09:10', topic: '今日计划' },
  },
]

console.log('=== DeepSeek planner integration ===')
const results: Array<{ label: string; speak: boolean; message: string; reason: string }> = []

for (const s of scenarios) {
  process.stdout.write(`-> ${s.label} ... `)
  const plan = await planWithLlm(s.config, s.input)
  results.push({ label: s.label, ...plan })
  console.log(`speak=${plan.speak}`)
  console.log(`  message: ${plan.message}`)
  console.log(`  reason: ${plan.reason}`)
}

console.log('character sample:')
console.log(buildCharacterText(scenarios[0]!.config))

const spoke = results.filter(r => r.speak && r.message.length > 0).length
console.log('DEEPSEEK_RESULT', JSON.stringify({
  total: results.length,
  spoke,
  samples: results.map(r => r.message),
}))
if (spoke < 3) process.exitCode = 1
process.exit(process.exitCode ?? 0)
