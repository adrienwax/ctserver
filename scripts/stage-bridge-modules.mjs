// Windows packaging only; installed/source dependencies are never modified.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const pins = {
  'device.js': '54a22f75891e6d3dbeceb827604cc0bccd6d3a2a4162c9307b0a910bb25bcb2b',
  'connections/serial.js': 'e05864eb78230818c0cafd620be6d3eb39365f3996f0e98046b63ac873f24346',
  'connections/ws.js': '3d0612c34557ad877ae2a15b9f1c9fe65c971070b3c41a343b67dd66ad5f5867',
  'connections/web-serial.js': '5ae1a2bf091297a8253d20b9eb67c47eb70d2d0d0f371e917fdc70492dfbb0d5',
};
// Verified dependency test directories; do not prune runtime files by extension.
const developmentOnly = new Set(['bl/test', 'github-from-package/test', 'minimist/test', 'rc/test', 'simple-concat/test', 'tar-fs/test']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalImport = "import { Emitter as EventEmitter } from 'strict-event-emitter'";

export function stageBridgeModules(source, destination) {
  if (!path.isAbsolute(destination) || fs.existsSync(destination)) throw Error('Bridge staging requires a new absolute destination.');
  const parent = path.dirname(destination);
  if (fs.realpathSync(parent).toLowerCase() !== path.resolve(parent).toLowerCase()) throw Error('Redirected staging parent refused.');
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'loupedeck/package.json')));
  if (pkg.version !== '7.0.3' || pkg.dependencies?.['strict-event-emitter'] !== '^0.5.1') throw Error('Review the changed loupedeck dependency before packaging.');
  const patches = Object.entries(pins).map(([file, sha256]) => {
    const bytes = fs.readFileSync(path.join(source, 'loupedeck', file));
    if (digest(bytes) !== sha256) throw Error(`Review changed loupedeck file: ${file}`);
    const text = bytes.toString('utf8');
    if (text.split(originalImport).length !== 2) throw Error(`Unexpected emitter import in ${file}`);
    return { file, before: sha256, text: text.replace(originalImport, "import { EventEmitter } from 'node:events'") };
  });
  const omitted = [];
  fs.cpSync(source, destination, { recursive: true, dereference: true, filter: file => {
    const relative = path.relative(source, file);
    const parts = relative.split(path.sep);
    const prebuild = parts.lastIndexOf('prebuilds');
    const skip = developmentOnly.has(relative.replaceAll(path.sep, '/')) || parts.includes('strict-event-emitter') || path.basename(file) === '.package-lock.json'
      || (prebuild >= 0 && parts.length > prebuild + 1 && parts[prebuild + 1] !== 'win32-x64');
    if (skip) omitted.push(relative.replaceAll(path.sep, '/'));
    return !skip;
  } });
  for (const patch of patches) fs.writeFileSync(path.join(destination, 'loupedeck', patch.file), patch.text);
  delete pkg.dependencies['strict-event-emitter'];
  fs.writeFileSync(path.join(destination, 'loupedeck/package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const notes = {
    schema: 1, platform: 'win32-x64', package: 'loupedeck', version: '7.0.3',
    change: 'Windows-only staged build uses Node EventEmitter in four files. Original MIT notice retained. No strict-event-emitter code is distributed in this runtime.',
    compatibility: 'Pinned loupedeck emits named device events, not error events. Node unhandled error-event semantics differ; re-review this transform on dependency updates.',
    patches: patches.map(p => ({ file: p.file, before: p.before, after: digest(p.text) })), omitted,
  };
  fs.writeFileSync(path.join(destination, 'CTSERVER-PACKAGING-NOTES.json'), JSON.stringify(notes, null, 2) + '\n');
  return notes;
}
