import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const launcher=read('waxyct.bat');
for(const pkg of ['serialport','loupedeck'])assert(launcher.includes(`integrations\\ct-td-control\\node_modules\\${pkg}\\package.json`));
assert(launcher.includes('npm run setup:bridge'));
assert(launcher.includes('node router.mjs --open'));
assert(!/Expand-Archive|ct-deps\.zip|\.\.\\ct-td-control/.test(launcher));
assert(fs.existsSync(new URL('../integrations/ct-td-control/connect-ct.mjs',import.meta.url)));
const config=JSON.parse(read('config.example.json'));
assert.equal(config.bridgeDir,'integrations/ct-td-control');
assert.equal(config.edenaDir,undefined);
for(const name of ['check-rotary-ui.mjs','check-router-ui.mjs','check-ui-browser.mjs']){
 const source=read('scripts/'+name);assert(!source.includes('../../moshpit-v3'));assert(source.includes('CT_PLAYWRIGHT_MODULE'));
}
console.log('Source launcher/default/browser-dependency references passed; no app was launched.');
