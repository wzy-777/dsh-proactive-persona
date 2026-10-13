# dsh-proactive-persona

**DeepSeek Harness plugin** that lets an agent **initiate conversation based on personality** — not just wait for the user to speak.

基于性格主动发起对话的 DeepSeek Harness 插件（Agent 自主化）。

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## What it does / 功能

- Proactively speaks up after idle time, daily clocks, stalled goals, or external webhooks
- Shapes every line with a configurable **persona** (name, traits, tone, topics)
- Keeps **one personality** across proactive openers and passive replies
- Respects quiet hours, cooldowns, daily caps — easy to mute

空闲 / 定点 / 目标停滞 / 外部事件后主动开口；语气、性格、话题可配置；主动与被动同一人格；静默与频率可控。

### Sample voices（同一管线，不同人格）

| Tone | Sample |
|------|--------|
| warm-casual | 刚看你那边好像安静了一会儿，工程今天推进得咋样了？ |
| dry | 你的架构评审卡了三天了。要么写清楚目标，要么承认它不该存在。 |
| playful | 嘿，日历刚弹了个提醒——新玩具有没有好玩的进展？ |
| formal | 早上好。适合先把今天要做的事定下来。你打算先处理哪一件？ |

---

## Architecture / 架构

```text
Trigger  →  Gate  →  Planner  →  Delivery  →  Memory
何时想说     该不该说    说什么/怎么说     投递进会话     防重复

idle          quiet       LLM (DeepSeek    agent.followup
clock         cooldown    / OpenAI-style)  + inject
goal-stall    daily cap   or template      + sessions.flush
webhook       initiative
```

Delivery reuses the same path as Harness **Schedule** reminders:

```ts
resolved.agent.inject(continuity)   // keep character across turns
resolved.agent.followup(message)    // enter Session inbox + wake agent
await ctx.sessions.flush(session)   // durable ack
```

---

## Quick start / 快速开始

### 1. Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) checkout (developer preview)
- Node.js `^22.19 || >=24`
- Optional: DeepSeek / OpenAI-compatible API key for LLM planning

### 2. Load the plugin

From the harness repo:

```sh
pnpm dsh --profile web --patch /absolute/path/to/dsh-proactive-persona/cordis.example.yml --no-open
```

Edit the absolute path in `cordis.example.yml` first.

### 3. Enable LLM personality (optional)

```yaml
# cordis.example.yml
planner:
  enabled: true
  baseUrl: 'https://api.deepseek.com/v1'
  apiKey: ''          # inject via env / local override — never commit keys
  model: 'deepseek-chat'
```

Without `planner.enabled`, the plugin falls back to template openers.

---

## Slash commands / 命令

| Command | Action |
|---------|--------|
| `/persona-quiet [minutes]` | Mute proactive speech (default 120) |
| `/persona-talk [sessionId]` | Speak once immediately |
| `/persona-unmute` | Unmute |
| `/persona-status` | Show status JSON |

---

## Configuration / 配置

See `cordis.example.yml` and `src/config.ts`.

| Key | Meaning |
|-----|---------|
| `persona.name` / `traits` / `tone` | Who is speaking |
| `persona.topics` / `openers` | What they care about |
| `persona.initiative` | 0 = almost silent, 1 = very chatty |
| `policy.quietHours` | Local windows `HH:MM-HH:MM` |
| `policy.minIntervalMinutes` / `maxPerDay` | Rate limits |
| `triggers.idleMinutes` | Idle threshold |
| `triggers.clockRules` | Daily local times e.g. `['09:10','21:30']` |
| `triggers.goalStallMinutes` | Goal-stall nudge (0 = off) |
| `triggers.externalEnabled` | Webhook triggers |
| `planner.*` | LLM planner (OpenAI-compatible) |

---

## Repo layout / 目录

```text
src/
  index.ts          # apply(), tick, slash commands
  config.ts         # Schemastery config
  gate.ts           # quiet / cooldown / cap / initiative
  persona.ts        # template planner
  persona-prompt.ts # system-prompt character + continuity
  planner.ts        # LLM planner + template fallback
  delivery.ts       # inject + followup + flush
  memory.ts         # dedupe / topic scores
  goals-stall.ts    # ctx.goals stall signals
  external.ts       # optional webhook trigger
examples/
  smoke-load.ts     # mock-context load test
  e2e.ts            # full pipeline assertions
  demo-live.ts      # multi-persona demo (in-process model)
  e2e-deepseek.ts   # real DeepSeek API check
DESIGN.md           # design notes
```

---

## Safety / 安全

- Defaults are conservative (cooldown, daily cap, night quiet)
- Proactive path **only speaks** — it does not auto-run privileged tools
- `/persona-quiet` mutes immediately
- **Never commit API keys** — use environment variables or a gitignored local patch

---

## Development / 开发

```sh
# mock context load
pnpm smoke

# full pipeline e2e
pnpm e2e

# multi-persona demo (no external API)
pnpm demo

# real DeepSeek API
$env:DEEPSEEK_API_KEY = 'sk-...'   # your key
pnpm e2e:deepseek
```

Works against DeepSeek Harness developer preview. APIs may change; verify against your checkout.

---

## Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — everything-is-a-plugin agent harness
- [Cordis](https://github.com/cordiverse/cordis) — plugin framework

## License

[MIT](LICENSE)
