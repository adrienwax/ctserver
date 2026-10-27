// Only local configuration supplies app routes; imported profiles cannot override these pins.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
export function guidesRoute(){
  const file=path.join(root,'ui','guide.html');
  try { if(!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error(); return {file}; }
  catch { return {error:'The bundled CTserver guide is missing. Repair this installation.'}; }
}
export function homeAppRoute(id,configDir=process.env.WAXYCT_CONFIG || path.join(root,'config')){
  if(!['moshpit','touchdesigner'].includes(id))return {error:'No verified app route'};
  try {
    const app=JSON.parse(fs.readFileSync(path.join(configDir,'apps.json'),'utf8'))[id];
    if(typeof app?.launch!=='string' || !/^[a-z]:[\\/]/i.test(app.launch) || !/\.exe$/i.test(app.launch) || !/^[a-f0-9]{64}$/i.test(app.launchSha256 || '')) return {error:'Open the app normally, or configure its executable and SHA-256 in apps.json. See Guides.'};
    const file=path.resolve(app.launch);
    for(let current=file;;current=path.dirname(current)){
      if(fs.lstatSync(current).isSymbolicLink() || fs.realpathSync(current).toLowerCase()!==current.toLowerCase()) throw Error();
      if(current===path.dirname(current))break;
    }
    if(!fs.statSync(file).isFile() || createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==app.launchSha256.toLowerCase())throw Error();
    return {file};
  } catch { return {error:'Application changed or missing; check its configured launch route.'}; }
}
