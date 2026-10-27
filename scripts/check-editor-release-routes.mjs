import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {homeAppRoute,guidesRoute} from '../host/home-routes.mjs';
import {checkApps,checkProfile} from '../host/profiles.mjs';
const config=new URL('../config/',import.meta.url);
test('generic defaults validate without a private project or automatic app launch',()=>{
  const apps=JSON.parse(fs.readFileSync(new URL('apps.json',config),'utf8'));
  assert.deepEqual(checkApps(apps),[]);
  const dir=new URL('profiles/',config),files=fs.readdirSync(dir),ids=files.map(f=>f.slice(0,-5));
  assert.deepEqual(ids.sort(),['main','moshpit','resolve','spotify','windows']);
  for(const file of files)assert.deepEqual(checkProfile(JSON.parse(fs.readFileSync(new URL(file,dir),'utf8')),ids,apps),[],file);
  for(const app of Object.values(apps))if(typeof app==='object')assert.equal(app.launch,undefined);
  assert.equal(apps.touchdesigner.default,undefined);
  assert.match(homeAppRoute('moshpit').error,/Open the app normally/);
  assert.match(guidesRoute().file,/guide\.html$/);
  assert.deepEqual(checkApps({x:{name:'X',target:'keys',launchSha256:'bad'}}).length,1);
});
test('verified routes reject changed binaries, missing hashes, relative paths and arbitrary IDs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ct-public-route-'));
  // Inert bytes: this test never executes an application.
  const file=path.join(dir,'Example.exe');fs.writeFileSync(file,'inert fixture');
  const sha=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const put=app=>fs.writeFileSync(path.join(dir,'apps.json'),JSON.stringify({moshpit:app}));
  put({launch:file,launchSha256:sha});assert.equal(homeAppRoute('moshpit',dir).file,file);
  assert(homeAppRoute('other',dir).error);
  fs.appendFileSync(file,'changed');assert(homeAppRoute('moshpit',dir).error);
  for(const app of [{launch:file},{launch:'Example.exe',launchSha256:sha},{launch:{path:file},launchSha256:sha},{launch:file,launchSha256:'bad'}]){put(app);assert(homeAppRoute('moshpit',dir).error);}
  // Keep fixture evidence in the dedicated test scratch directory.
});
