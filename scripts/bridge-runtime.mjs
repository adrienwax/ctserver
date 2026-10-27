import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function bridgeRuntimeFiles(directory) {
  const assets = ['config.json', 'package.json', 'knob-names.json']
  for (const file of assets) if (!fs.existsSync(path.join(directory, file))) throw new Error(`Missing CT runtime asset: ${file}`)
  return [...fs.readdirSync(directory).filter(f => f.endsWith('.mjs')), ...assets]
}

// Exercise the staged display import and screen rendering, not just a matching copy list.
// This imports no serial/device modules and never opens the CT.
export function checkBridgeDisplay(directory, executable = process.execPath, env = process.env) {
  const moduleUrl = pathToFileURL(path.join(directory, 'ct-draw.mjs')).href
  const code = `import assert from 'node:assert/strict';
    const d = await import(${JSON.stringify(moduleUrl)});
    assert(Object.keys(d.KNOB_NAMES).length > 0);
    assert.equal(d.toRgb565(d.renderKeys([])).length, 360 * 270 * 2);
    assert.equal(d.toRgb565(d.renderStrip('left', 'dreamfb', [0, .5, 1], .5)).length, 60 * 270 * 2);`
  execFileSync(executable, ['--input-type=module', '-e', code], { env, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
}
