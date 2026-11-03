import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// This checks notice integrity only, not distribution clearance.
export function checkNoticePins(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'third-party/NOTICE-MANIFEST.json')));
  let count = 0;
  for (const pkg of manifest.packages) for (const notice of pkg.notices ?? []) {
    const file = path.resolve(root, notice.file);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Notice path escapes source.');
    const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== notice.sha256) throw Error(`Notice bytes changed: ${notice.file}. Restore the reviewed bytes before packaging.`);
    count++;
  }
  if (!count) throw Error('No dependency notices checked.');
  return count;
}
