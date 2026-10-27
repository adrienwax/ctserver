import { exeName } from './win-input.mjs'
// App shortcuts must still belong to their captured page when async focus finishes.
export async function guardAppInput(win, exe, current, fail) {
  const target = exeName(exe).toLowerCase()
  if (!current()) return false
  if (await win.front() !== target) {
    if (!current()) return false
    if (!await win.running(exe)) { fail('is not running'); return false }
    if (!current()) return false
    const focused = await win.focus(exe)
    if (focused !== 'ok') { fail(`would not come forward (${focused})`); return false }
  }
  if (!current()) return false
  if (await win.front() !== target) { fail('focus changed before sending keys'); return false }
  return current()
}
