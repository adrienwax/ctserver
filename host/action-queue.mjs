import { ctResolve, ctSide, MAX_REPEAT } from './moshpit-client.mjs'

const isStep = action => (action.moshpit || action).verb === 'step'

// Resolve selected-slot/bank aliases when the hand moves, not after a slow ACK.
// The generation travels with that captured path so it cannot acquire new meaning.
export function captureAction(action, client, slot, bank) {
  if (action.macro) return { ...action, macro: action.macro.map(a => a.wait === undefined ? captureAction(a, client, slot, bank) : a) }
  const v = action.moshpit
  if (!v || ctSide(v) || ['command', 'step'].includes(v.verb)) return action
  const resolved = ctResolve(v, slot, bank), target = resolved && client?.resolve(resolved)
  return { ...action, moshpit: { ...resolved, path: target, captured: true, generation: client?.state().generation } }
}

// Keep an in-flight lane alive across cancellation. Clearing a Map of busy lanes
// would let a new event launch a second concurrent pump for the same physical dial.
export function createActionQueue({ context, execute, error = () => {}, limit = 32 }) {
  const lanes = new Map()
  async function pump(key, lane) {
    lane.busy = true
    try {
      while (lane.jobs.length) {
        const job = lane.jobs.shift()
        if (job.context !== context()) continue
        // The wire permits at most ten frame commands per message. Retain the
        // remainder here, so each ACK releases just one chunk and cancellation
        // or a page/selection change can still discard all unsent work.
        if (isStep(job.action) && Math.abs(job.delta) > MAX_REPEAT) {
          const delta = Math.sign(job.delta) * MAX_REPEAT
          const rest = { ...job, delta: job.delta - delta }
          lane.jobs.unshift(rest)
          job.delta = delta
        }
        try { await execute(job) } catch (e) {
          // An uncertain ACK is never retried, nor followed by this burst's tail.
          // The tail may have arrived as separate detents while this chunk was
          // waiting, rather than as the residual of one large encoder event.
          if (isStep(job.action)) lane.jobs = lane.jobs.filter(j => j.context !== job.context || j.signature !== job.signature)
          error(e, job)
        }
      }
    } finally { lane.busy = false; if (lanes.get(key) === lane) lanes.delete(key) }
  }
  return {
    run(key, action, what, delta = 0, mode = 'normal') {
      if (isStep(action) && !Number.isSafeInteger(delta)) { error(new Error('wheel detents must be a finite safe integer; input was discarded'), { what }); return }
      let lane = lanes.get(key)
      if (!lane) lanes.set(key, lane = { busy: false, jobs: [] })
      const stamp = context(), signature = JSON.stringify([action, mode])
      // Remove cancelled work before applying the bounded queue limit.
      lane.jobs = lane.jobs.filter(j => j.context === stamp)
      if (isStep(action)) {
        delta ||= 1 // A discrete step action with no encoder delta advances once.
        // Count work, not just queue entries: coalescing must not turn a bounded
        // queue into thousands of future frame commands. Knob semantics stay as-is.
        const pending = lane.jobs.reduce((n, j) => n + (isStep(j.action) ? Math.abs(j.delta) || 1 : 0), 0)
        const available = Math.max(0, limit * MAX_REPEAT - pending)
        if (Math.abs(delta) > available) {
          error(new Error(`wheel backlog is full; ${Math.abs(delta) - available} detents were discarded`), { what })
          delta = Math.sign(delta) * available
          if (!delta) return
        }
      }
      const tail = lane.jobs.at(-1)
      // Keep reversals in order: +2 then -2 at a clamped maximum is not a no-op.
      if (delta && tail?.delta && Math.sign(delta) === Math.sign(tail.delta) && tail.context === stamp && tail.signature === signature) {
        tail.delta += delta
      } else if (lane.jobs.length < limit) lane.jobs.push({ action, what, delta, mode, context: stamp, signature })
      else error(new Error('control queue is full; input was discarded'), { what })
      if (!lane.busy) void pump(key, lane)
    },
    clear() { for (const lane of lanes.values()) lane.jobs = [] },
  }
}
