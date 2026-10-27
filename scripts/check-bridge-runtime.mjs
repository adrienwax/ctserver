import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bridgeRuntimeFiles, checkBridgeDisplay } from './bridge-runtime.mjs'
const bridge = fileURLToPath(new URL('../integrations/ct-td-control/', import.meta.url))
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-display-stage-'))
try {
  for (const file of bridgeRuntimeFiles(bridge)) fs.copyFileSync(path.join(bridge, file), path.join(stage, file))
  checkBridgeDisplay(stage)
  fs.rmSync(path.join(stage, 'knob-names.json'))
  assert.throws(() => checkBridgeDisplay(stage), /knob-names\.json/)
  assert.throws(() => bridgeRuntimeFiles(stage), /Missing CT runtime asset: knob-names\.json/)
  console.log('3 staged display checks passed: import/render, missing-asset failure, manifest rejection; no CT opened')
} finally { fs.rmSync(stage, { recursive: true, force: true }) }
