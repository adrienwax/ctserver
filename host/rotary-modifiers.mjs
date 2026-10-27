// Physical CT modifiers only: never presses or holds Windows modifier keys.
// Firmware ids are named by loupedeck's BUTTONS table (Keyboard 0x11, Fn 0x14/0x17).
export function createRotaryModifiers() {
  const held = new Set()
  const owns = id => ['keyboard', 'fnL', 'fnR'].includes(id)
  return {
    down(id) { if (!owns(id)) return false; held.add(id); return true },
    up(id) { if (!owns(id)) return false; held.delete(id); return true },
    fnHeld: () => held.has('fnL') || held.has('fnR'),
    mode: () => held.has('keyboard') ? 'fine' : held.has('fnL') || held.has('fnR') ? 'coarse' : 'normal',
    reset: () => held.clear(),
  }
}

export const continuousFactor = mode => mode === 'fine' ? 0.1 : mode === 'coarse' ? 10 : 1
// Discrete controls retain their smallest legal increment: fine never rounds a detent to zero.
export const discreteDelta = (delta, mode) => delta * (mode === 'coarse' ? 5 : 1)

// The Windows helper limits one volume request to 20 taps. Preserve a coalesced rotary
// burst with paced chunks rather than silently dropping its tail or flooding SendInput.
export async function volumeChunks(steps, send, current = () => true) {
  let remaining = Math.round(steps)
  while (remaining && current()) {
    const part = Math.sign(remaining) * Math.min(20, Math.abs(remaining))
    await send(part)
    remaining -= part
  }
}
