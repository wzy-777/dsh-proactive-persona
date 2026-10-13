/**
 * Multi-persona live-style demo (no external API).
 * In-process OpenAI-compatible model returns style-matched lines.
 *
 * Run (cwd = deepseek-harness-master):
 *   node --import tsx/esm ../dsh-proactive-persona/examples/demo-live.ts
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const { planWithLlm } = await import(pathToFileURL(path.join(root, 'src/planner.ts')).href)
const { createGateState, evaluateGate, markSpoke, muteFor } = await import(
  pathToFileURL(path.join(root, 'src/gate.ts')).href
)
const { deliverFollowup } = await import(pathToFileURL(path.join(root, 'src/delivery.ts')).href)

function authorReply(userPrompt: string): string {
  const topic = /topic:\s*([^\n]+)/.exec(userPrompt)?.[1]?.trim()
    || /话题倾向：([^\n。]+)/.exec(userPrompt)?.[1]?.trim()
    || 'recent work'
  const signal = /signal:\s*([^\n]+)/.exec(userPrompt)?.[1]?.trim()
    || /触发信号：([^\n。]+)/.exec(userPrompt)?.[1]?.trim()
    || 'idle'
  const tone = /tone:\s*([^\n]+)/.exec(userPrompt)?.[1]?.trim()
    || /语气：([^\n。]+)/.exec(userPrompt)?.[1]
    || ''

  let message: string
  if (signal.startsWith('goal-stall')) {
    message = `「${topic}」 seems stuck. Want me to break it into next steps?`
  } else if (tone.includes('dry') || tone.includes('cool')) {
    message = `(${topic}) Still moving? I can list risks only if that helps.`
  } else if (tone.includes('playful')) {
    message = `Hey — poked by calendar. Any fun progress on ${topic}?`
  } else {
    message = `Checking in: how is ${topic} going?`
  }
  return JSON.stringify({ speak: true, message, reason: `authored:${signal}` })
}

const modelServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c: Buffer) => { body += c })
  req.on('end', () => {
    let prompt = ''
    try {
      const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> }
      prompt = parsed.messages?.filter(m => m.role === 'user').map(m => m.content).join('\n') ?? ''
    } catch { /* ignore */ }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: authorReply(prompt) } }] }))
  })
})
await new Promise<void>(resolve => modelServer.listen(8798, '127.0.0.1', resolve))

const transcript: Array<{ role: string; text: string }> = []
const agent = {
  id: 'sess-live',
  session: { id: 'sess-live' },
  followup: (m: { content: Array<{ text: string }> }) => {
    transcript.push({ role: 'agent-to-user', text: m.content[0]?.text ?? '' })
  },
  inject: (m: { content: Array<{ text: string }> }) => {
    transcript.push({ role: 'inject', text: m.content[0]?.text ?? '' })
  },
}

const ctx = {
  get: () => undefined,
  effect: (fn: () => unknown) => {
    const r = fn()
    return typeof r === 'function' ? r : () => {}
  },
  on: () => () => {},
  logger: { info: (m: string) => transcript.push({ role: 'log', text: m }), warn: () => {}, debug: () => {} },
  agents: { list: () => [agent] },
  sessions: { flush: async () => true },
  sessionController: { resolveAgent: async () => ({ agent }) },
  commands: { register: () => () => {} },
}

function baseConfig(tone: 'warm-casual' | 'dry' | 'playful', topics: string[]) {
  return {
    persona: {
      name: 'A-Shen',
      traits: ['curious'],
      tone,
      language: 'en',
      initiative: 0.85,
      topics,
      openers: ['template fallback {topic}'],
    },
    policy: { quietHours: [], minIntervalMinutes: 0, maxPerDay: 50, respectFocus: false },
    triggers: {
      idleMinutes: 1,
      tickSeconds: 3600,
      clockRules: [],
      goalStallMinutes: 0,
      externalEnabled: false,
      externalKind: 'x',
    },
    planner: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8798/v1',
      apiKey: 'local',
      model: 'authored',
      temperature: 0.8,
      maxTokens: 128,
    },
  }
}

async function run(label: string, cfg: ReturnType<typeof baseConfig>, signalKind: string, topic: string) {
  transcript.push({ role: 'scene', text: `${label} signal=${signalKind} topic=${topic}` })
  const gate = createGateState()
  const decision = evaluateGate(cfg, gate, {
    signalKind,
    topic,
    forceInitiative: !signalKind.startsWith('idle'),
  })
  if (!decision.allow) {
    transcript.push({ role: 'gate', text: JSON.stringify(decision) })
    return
  }
  const plan = await planWithLlm(cfg, { signalKind, topic })
  markSpoke(gate)
  transcript.push({ role: 'plan', text: `${plan.reason} -> ${plan.message}` })
  await deliverFollowup(ctx as never, cfg as never, 'sess-live', plan.message)
}

console.log('=== Live-style demo (authored personas, in-process model) ===')
await run('warm-idle', baseConfig('warm-casual', ['engineering']), 'idle', 'engineering')
await run('dry-goal-stall', baseConfig('dry', ['architecture review']), 'goal-stall:active', 'architecture review')
await run('playful-external', baseConfig('playful', ['new toy']), 'external:calendar', 'new toy')

const gate = createGateState()
muteFor(gate, 60)
const blocked = evaluateGate(baseConfig('warm-casual', ['x']), gate, { signalKind: 'idle' })
transcript.push({ role: 'scene', text: 'quiet-then-idle' })
transcript.push({ role: 'gate', text: JSON.stringify(blocked) })

for (const line of transcript) {
  console.log(`[${line.role}] ${line.text}`)
}

const spoken = transcript.filter(t => t.role === 'agent-to-user')
console.log('DEMO_RESULT', JSON.stringify({
  spoken: spoken.length,
  quietBlocked: !blocked.allow,
  samples: spoken.map(s => s.text),
}))

modelServer.close()
process.exit(0)
