// GUI child processes must not inherit the Electron host's Node-only startup mode.
import { spawn } from 'node:child_process'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && !value.includes('\0')

export function normalizeLaunch(value) {
  const spec = typeof value === 'string' ? { path: value } : value
  if (!object(spec) || Object.keys(spec).some(key => !['path', 'args', 'env'].includes(key))) throw new TypeError('launch must be a program path or { path, args?, env? }')
  if (!text(spec.path) || !spec.path.trim()) throw new TypeError('launch.path must be a non-empty program path without NUL characters')
  if (spec.args !== undefined && (!Array.isArray(spec.args) || !spec.args.every(text))) throw new TypeError('launch.args must be an array of strings without NUL characters')
  if (spec.env !== undefined && !object(spec.env)) throw new TypeError('launch.env must be an object of environment variable names and string values')
  const env = {}
  const names = new Set()
  for (const [name, value] of Object.entries(spec.env || {})) {
    const key = name.toUpperCase()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(key) || !text(value)) throw new TypeError('launch.env needs unique variable names and string values without NUL characters')
    names.add(key)
    Object.defineProperty(env, name, { value, enumerable: true, writable: true, configurable: true })
  }
  return { path: spec.path, args: [...(spec.args || [])], env }
}

export function launchGui(target, { spawnImpl = spawn, env = process.env, onError = () => {}, dry = false, onDry = () => {} } = {}) {
  try {
    const spec = normalizeLaunch(target)
    if (dry) { onDry(spec.path); return null }
    // Windows names are case insensitive. Remove the inherited spelling before overriding it.
    const childEnv = { ...env }
    for (const [name, value] of Object.entries(spec.env)) {
      for (const inherited of Object.keys(childEnv)) if (inherited.toUpperCase() === name.toUpperCase()) delete childEnv[inherited]
      Object.defineProperty(childEnv, name, { value, enumerable: true, writable: true, configurable: true })
    }
    for (const name of Object.keys(childEnv)) if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete childEnv[name]
    const child = spawnImpl(spec.path, spec.args, { detached: true, stdio: 'ignore', shell: false, env: childEnv })
    // A missing executable normally fails asynchronously, outside a try/catch around spawn.
    child.on('error', error => onError(error, spec.path))
    child.unref()
    return child
  } catch (error) { onError(error, typeof target === 'string' ? target : target?.path); return null }
}
