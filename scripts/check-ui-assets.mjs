import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function checkUIAssets(root) {
  const source = fs.readFileSync(path.join(root, 'router.mjs'), 'utf8');
  const table = source.match(/const UI = \{([\s\S]*?)\n\}/)?.[1];
  if (!table) throw Error('UI route table missing');
  const routes = [...table.matchAll(/^\s*'([^']+)': \['([^']+)'/gm)];
  if (routes.length < 10) throw Error('UI route table changed; review asset check');
  for (const [, route, file] of routes) if (!fs.statSync(path.join(root, 'ui', file)).isFile()) throw Error(`Missing UI resource: ${route}`);
  const fonts = JSON.parse(fs.readFileSync(path.join(root, 'ui/fonts/FONT-MANIFEST.json')));
  for (const item of fonts.files) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(root, item.file))).digest('hex');
    if (actual !== item.sha256) throw Error(`Font or notice changed: ${item.file}`);
  }
  return { routes: routes.length, fontPins: fonts.files.length };
}
