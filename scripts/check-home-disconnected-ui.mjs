// Actual desktop UI, shared Home controller and shared key SVG. Browser fixture only.
import assert from 'node:assert/strict';import fs from 'node:fs';import net from 'node:net';import path from 'node:path';import {fork} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';import {ensureScratch} from './build-scratch/bootstrap.mjs';
const s=ensureScratch('portable-test'),root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=await import(process.env.CT_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.CT_PLAYWRIGHT_MODULE).href : 'playwright');
const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
const child=fork(path.join(root,'scripts/serve-icon-fixture.mjs'),[],{env:{...process.env,WAXYCT_FIXTURE_PORT:String(port),WAXYCT_FIXTURE_DISCONNECTED:'1'},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let browser;
try{
await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),8000);child.stdout.on('data',d=>{if(String(d).includes('Icon scratch fixture')){clearTimeout(t);resolve()}});child.once('exit',c=>reject(Error('fixture exited'+c)))});
browser=await chromium.launch({channel:'msedge',headless:true});const pg=await browser.newPage({viewport:{width:1080,height:780}});const errors=[],calls=[];pg.on('pageerror',e=>errors.push(e.message));

const commands=[];child.on('message',m=>{if(m.type==='unexpected-command')commands.push(m)});
await pg.goto('http://127.0.0.1:'+port+'/');await pg.waitForFunction(()=>document.querySelector('#home-detail')?.textContent.includes('CT not connected')&&document.querySelector('[data-k="center:8"] .key-glyph svg'));
await pg.waitForFunction(()=>document.querySelector('#banner').hidden);
const key=n=>pg.locator('[data-k="center:'+n+'"]');for(let i=0;i<9;i++)assert.equal(await key(i).locator('.key-glyph svg').count(),1);
assert.equal(await key(0).getAttribute('aria-disabled'),'true');assert.equal(await key(4).getAttribute('aria-disabled'),'false');assert.equal(await pg.locator('#app-select option[value="moshpit"]').count(),1);
await key(0).dispatchEvent('click');await key(3).dispatchEvent('click');await key(6).dispatchEvent('click');assert.deepEqual(commands,[]);
await pg.screenshot({path:path.join(s.artifacts,'disconnected-home-1080.png')});
await key(4).click();await pg.waitForFunction(()=>!document.querySelector('.profile-picker-popup').hidden);assert((await pg.locator('.profile-picker-option').count())>=2);await pg.locator('.profile-picker-popup').getByRole('option').filter({hasText:'MOSHPIT'}).click();await pg.waitForFunction(()=>document.querySelector('#editing-target').textContent.includes('Configured'));await pg.locator('.pgtab[data-page="1"]').click();assert.deepEqual(commands,[]);await pg.locator('#app-select').selectOption('main');await pg.waitForFunction(()=>document.querySelector('#home-detail')&&!document.querySelector('#home-detail').hidden);assert.deepEqual(commands,[]);
await key(8).click();await pg.waitForFunction(()=>document.querySelector('#app').dataset.view==='status');assert.deepEqual(commands,[]);await pg.getByRole('tab',{name:'Live',exact:true}).click();await key(7).click();await pg.waitForFunction(()=>document.querySelector('#app').dataset.view==='customize');assert.deepEqual(commands,[]);
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(s.artifacts,'DISCONNECTED-UI-RESULT.json'),JSON.stringify({checks:['actual null-host SSE first launch displays nine configured tiles and real profile/app inventory','hardware/app Home actions unavailable; dispatching click causes no command POST','profile chooser and Setup/Device local inspection work without a host','compact1080x780 screenshot; no fake connected/readiness state'],errors,commands,limits:'Actual desktop/read-only inventory through inert HTTP fixture; no native/device/TD/action side effects'},null,2));console.log(JSON.stringify({artifacts:s.artifacts,errors,commands}));
}finally{if(browser)await browser.close();if(child.connected)child.send('close');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
