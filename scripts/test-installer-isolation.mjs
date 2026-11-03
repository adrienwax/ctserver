import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {initHomeCandidate} from '../host/home-candidate.mjs';
const afterPack=createRequire(import.meta.url)('./installer-after-pack.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ct-installer-test-'));
const saved={...process.env};
function reset(){for(const key of ['WAXYCT_HOME_CANDIDATE_ROOT','WAXYCT_CONFIG','WAXYCT_ROUTER_CONFIG','WAXYCT_ROUTER_DATA'])delete process.env[key];}
test('ordinary source launch does not create or redirect settings',()=>{
 reset();const app={isPackaged:false,getPath(){throw Error('Unexpected settings access');},setPath(){throw Error('Unexpected settings change');}};
 assert.equal(initHomeCandidate(app,root),false);
});
test('installed candidate seeds private settings with device ownership off',()=>{
 reset();const dir=path.join(root,'app');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({localCandidate:true}));
 const appData=path.join(root,'appdata');let userData;
 const app={isPackaged:true,getPath(key){assert.equal(key,'appData');return appData;},setPath(key,value){assert.equal(key,'userData');userData=value;}};
 assert.equal(initHomeCandidate(app,dir),true);
 assert.equal(userData,path.join(appData,'CTserver KRAB Candidate','private-profile'));
 assert.equal(process.env.WAXYCT_CONFIG,path.join(userData,'config'));
 assert.deepEqual(JSON.parse(fs.readFileSync(process.env.WAXYCT_ROUTER_CONFIG)),{port:9994,hostAuto:false});
 assert.equal(fs.existsSync(path.join(appData,'waxyct')),false);
 const sentinel=path.join(userData,'keep.txt');fs.writeFileSync(sentinel,'keep');
 assert.equal(initHomeCandidate(app,dir),true);assert.equal(fs.readFileSync(sentinel,'utf8'),'keep');
 fs.writeFileSync(process.env.WAXYCT_ROUTER_CONFIG,JSON.stringify({port:9989,hostAuto:true}));
 assert.throws(()=>initHomeCandidate(app,dir),/dedicated port and manual device ownership/);
});
for(const candidate of [false,true])test(`packaged dependency layout and endpoint isolation: candidate=${candidate}`,async()=>{
 const appOutDir=path.join(root,`output-${candidate}`),resources=path.join(appOutDir,'resources');
 const modules=path.join(resources,'ct','modules');fs.mkdirSync(modules,{recursive:true});fs.writeFileSync(path.join(modules,'sentinel'),'module');
 const app=path.join(resources,'app');fs.mkdirSync(path.join(app,'config'),{recursive:true});fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({localCandidate:candidate}));
 const config=path.join(app,'config','apps.json');const original={moshpit:{exe:'Moshpit 3.exe',endpointFile:'%APPDATA%/Moshpit 3/control-endpoint.json'},windows:{target:'keys'}};
 fs.writeFileSync(config,JSON.stringify(original));await afterPack({appOutDir});
 assert.equal(fs.existsSync(modules),false);assert.equal(fs.readFileSync(path.join(resources,'ct','node_modules','sentinel'),'utf8'),'module');
 const actual=JSON.parse(fs.readFileSync(config));assert.deepEqual(actual.windows,original.windows);
 if(candidate){assert.equal(actual.moshpit.exe,'Moshpit KRAB Candidate.exe');assert.equal(actual.moshpit.endpointFile,'%APPDATA%/Moshpit KRAB Candidate/control-endpoint.json');}else assert.deepEqual(actual,original);
 await assert.rejects(()=>afterPack({appOutDir}),/Unexpected staged CT dependency layout/);
});
test.after(()=>{reset();for(const key of ['WAXYCT_HOME_CANDIDATE_ROOT','WAXYCT_CONFIG','WAXYCT_ROUTER_CONFIG','WAXYCT_ROUTER_DATA'])if(saved[key]!==undefined)process.env[key]=saved[key];});
