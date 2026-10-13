/**
 * Gate: decide whether a signal is allowed to become speech.
 * Hard filters first; personality initiative is a soft probability gate.
 */
import type { Config } from './config.ts'

export type GateDecision =
  | { allow: true; reason: string; score: number }
  | { allow: false; reason: string }

export interface GateState {
  lastSpokeAt: number | null
  spokeCountToday: number
  dayKey: string
  mutedUntil: number | null
}

export function createGateState(): GateState {
  return { lastSpokeAt: null, spokeCountToday: 0, dayKey: localDayKey(), mutedUntil: null }
}

export function localDayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Parse 'HH:MM-HH:MM' windows and test local now (supports overnight wrap). */
export function inQuietHours(windows: string[], now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  for (const w of windows) {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(w.trim())
    if (!m) continue
    const start = Number(m[1]) * 60 + Number(m[2])
    const end = Number(m[3]) * 60 + Number(m[4])
    if (start <= end) {
      if (minutes >= start && minutes < end) return true
    } else {
      // overnight: e.g. 23:00-08:00
      if (minutes >= start || minutes < end) return true
    }
  }
  return false
}

export interface GateInput {
  signalKind: string
  idleMs?: number
  busy?: boolean
  topic?: string
  /** External/clock signals skip the soft initiative probability gate. */
  forceInitiative?: boolean
}

export function evaluateGate(
  config: Config,
  state: GateState,
  input: GateInput,
  now = new Date(),
): GateDecision {
  const day = localDayKey(now)
  if (state.dayKey !== day) {
    state.dayKey = day
    state.spokeCountToday = 0
  }

  if (state.mutedUntil && now.getTime() < state.mutedUntil) {
    return { allow: false, reason: 'muted' }
  }

  if (inQuietHours(config.policy.quietHours, now)) {
    return { allow: false, reason: 'quiet-hours' }
  }

  if (input.busy && config.policy.respectFocus) {
    return { allow: false, reason: 'user-or-agent-busy' }
  }

  if (state.lastSpokeAt) {
    const gapMin = (now.getTime() - state.lastSpokeAt) / 60_000
    if (gapMin < config.policy.minIntervalMinutes) {
      return { allow: false, reason: `cooldown:${gapMin.toFixed(1)}m` }
    }
  }

  if (state.spokeCountToday >= config.policy.maxPerDay) {
    return { allow: false, reason: 'daily-cap' }
  }

  // Soft personality gate: higher initiative → higher pass probability.
  // External / scheduled signals may force through; idle stays probabilistic.
  const initiative = config.persona.initiative
  if (!input.forceInitiative) {
    const roll = pseudoRandom(now.getTime() + input.signalKind.length)
    if (roll > initiative) {
      return { allow: false, reason: `initiative-low:${roll.toFixed(2)}>${initiative}` }
    }
  }

  return { allow: true, reason: 'ok', score: initiative }
}

/** Tiny deterministic PRNG in [0,1) — enough for P0 probability gate. */
export function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10_000
  return x - Math.floor(x)
}

export function markSpoke(state: GateState, at = Date.now()): void {
  state.lastSpokeAt = at
  state.spokeCountToday += 1
}

export function muteFor(state: GateState, minutes: number, at = Date.now()): void {
  state.mutedUntil = at + minutes * 60_000
}

export function unmute(state: GateState): void {
  state.mutedUntil = null
}
