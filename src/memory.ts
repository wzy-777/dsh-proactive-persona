/**
 * Sent-memory: avoid repeating the same opener; lightweight feedback scoring.
 * P0 keeps this in-process; P1 can persist via SessionEventMap or a local JSONL.
 */

export interface SentRecord {
  at: number
  signalKind: string
  topic: string
  messageHash: string
  /** +1 user replied, -1 ignored long-term, 0 unknown */
  feedback: number
}

export interface Memory {
  sent: SentRecord[]
  topicScore: Record<string, number>
}

export function createMemory(): Memory {
  return { sent: [], topicScore: {} }
}

export function hashMessage(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

export function recentlySaid(memory: Memory, messageHash: string, withinMs = 6 * 3600_000): boolean {
  const now = Date.now()
  return memory.sent.some(r => r.messageHash === messageHash && now - r.at < withinMs)
}

export function recordSent(memory: Memory, rec: Omit<SentRecord, 'feedback'>): void {
  memory.sent.push({ ...rec, feedback: 0 })
  if (memory.sent.length > 200) memory.sent.splice(0, memory.sent.length - 200)
  memory.topicScore[rec.topic] = (memory.topicScore[rec.topic] ?? 0) + 0.1
}

export function recordFeedback(memory: Memory, topic: string, delta: number): void {
  memory.topicScore[topic] = (memory.topicScore[topic] ?? 0) + delta
}

/** Higher score → prefer this topic. */
export function rankTopics(memory: Memory, topics: string[]): string[] {
  return [...topics].sort((a, b) => (memory.topicScore[b] ?? 0) - (memory.topicScore[a] ?? 0))
}
