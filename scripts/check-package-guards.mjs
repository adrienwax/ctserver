import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { checkNoticePins } from './check-notice-pins.mjs';
import { stageBridgeModules } from './stage-bridge-modules.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-guards-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true });
  });
  return root;
}
test('notice gate rejects changed bytes, missing text, empty inventory and escaping paths', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'third-party'));
  const license = 'test notice\n';
  const sha256 = createHash('sha256').update(license).digest('hex');
  const write = notices => fs.writeFileSync(path.join(root, 'third-party/NOTICE-MANIFEST.json'), JSON.stringify({ packages: [{ notices }] }));
  fs.writeFileSync(path.join(root, 'LICENSE'), license);
  write([{ file: 'LICENSE', sha256 }]); assert.equal(checkNoticePins(root), 1);
  fs.writeFileSync(path.join(root, 'LICENSE'), license.replace('\n', '\r\n'));
  assert.throws(() => checkNoticePins(root), /Notice bytes changed/);
  write([{ file: 'missing', sha256 }]); assert.throws(() => checkNoticePins(root), /ENOENT/);
  write([]); assert.throws(() => checkNoticePins(root), /No dependency notices/);
  write([{ file: '../outside', sha256 }]); assert.throws(() => checkNoticePins(root), /escapes source/);
});
test('stage rejects existing destination and unreviewed dependency before copying', t => {
  const root = fixture(t), source = path.join(root, 'source'), destination = path.join(root, 'stage');
  fs.mkdirSync(path.join(source, 'loupedeck'), { recursive: true });
  assert.throws(() => stageBridgeModules(source, source), /new absolute destination/);
  const manifest = path.join(source, 'loupedeck/package.json');
  fs.writeFileSync(manifest, JSON.stringify({ version: '99', dependencies: {} }));
  assert.throws(() => stageBridgeModules(source, destination), /Review the changed/);
  assert.equal(fs.existsSync(destination), false);
  fs.writeFileSync(manifest, JSON.stringify({ version: '7.0.3', dependencies: { 'strict-event-emitter': '^0.5.1' } }));
  fs.writeFileSync(path.join(source, 'loupedeck/device.js'), 'changed upstream code');
  assert.throws(() => stageBridgeModules(source, destination), /Review changed loupedeck file/);
  assert.equal(fs.existsSync(destination), false);
});
test('staging keeps runtime and notices but excludes reviewed development fixtures', t => {
  const root = fixture(t), source = path.join(root, 'source'), destination = path.join(root, 'stage');
  const original = new URL('../integrations/ct-td-control/node_modules/loupedeck/', import.meta.url);
  for (const file of ['package.json', 'LICENSE', 'device.js', 'connections/serial.js', 'connections/ws.js', 'connections/web-serial.js']) {
    const target = path.join(source, 'loupedeck', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(new URL(file, original), target);
  }
  for (const file of ['bl/index.js', 'bl/LICENSE', 'bl/test/fixture.js', 'bl/testing-runtime.js', 'strict-event-emitter/index.js', 'native/prebuilds/win32-x64/runtime.node', 'native/prebuilds/linux-x64/runtime.node']) {
    const target = path.join(source, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file);
  }
  const report = stageBridgeModules(source, destination);
  assert.equal(report.patches.length, 4);
  for (const file of ['bl/index.js', 'bl/LICENSE', 'bl/testing-runtime.js', 'native/prebuilds/win32-x64/runtime.node', 'loupedeck/LICENSE']) assert(fs.existsSync(path.join(destination, file)));
  for (const file of ['bl/test', 'strict-event-emitter', 'native/prebuilds/linux-x64']) assert(!fs.existsSync(path.join(destination, file)));
  assert(fs.readFileSync(path.join(source, 'loupedeck/device.js'), 'utf8').includes('strict-event-emitter'));
  assert(fs.readFileSync(path.join(destination, 'loupedeck/device.js'), 'utf8').includes('node:events'));
});
