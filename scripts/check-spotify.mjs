import assert from 'node:assert/strict'
import {createSpotifyClient} from '../host/spotify-client.mjs'
import {checkApps,checkProfile} from '../host/profiles.mjs'
import fs from 'node:fs'
let clock=10000,track='track-1',writes=[],supported=true,playing=false
const win={spotify:async q=>{
 if(q.route==='state')return JSON.stringify({ok:true,contextId:track,workspace:'Spotify',playing,actions:['transport.play','transport.pause','transport.toggle'],parameters:[{id:'position',label:'POSITION',type:'float',value:20,min:0,max:100,step:5,default:0,available:supported},{id:'shuffle',label:'SHUFFLE',type:'bool',value:false,available:true}]})
 writes.push(q);if(q.action.contextId!==track)return JSON.stringify({ok:false,error:'Track changed'})
 return JSON.stringify({ok:true})
}}
const c=createSpotifyClient({win,now:()=>clock})
await c.refresh();assert(c.connected())
assert.equal(c.capture({verb:'command',command:'transport.stop'}),null)
let action=c.capture({verb:'turn',parameter:'position'})
await c.act(action,2,'fine');assert.equal(writes[0].action.mode,'fine');assert.equal(writes[0].deadlineUnixMs,11200)
track='track-2';await c.refresh();await assert.rejects(c.act(action,1,'normal'),/context changed/)
supported=false;await c.refresh();assert.equal(c.capture({verb:'turn',parameter:'position'}),null)
action=c.capture({verb:'toggle',parameter:'shuffle'});track='track-3'
await assert.rejects(c.act(action,1,'normal'),/Track changed/);assert.equal(writes.length,2)
clock+=2600;assert(!c.connected());assert.equal(c.capture({verb:'command',command:'transport.play'}),null)
c.stop()
const apps=JSON.parse(fs.readFileSync('config/apps.json','utf8'))
assert.deepEqual(checkApps(apps),[])
const p=JSON.parse(fs.readFileSync('config/profiles/spotify.json','utf8'))
assert.deepEqual(checkProfile(p,['main','spotify'],apps),[])
assert.equal(p.pages.length,2)
for(const pg of p.pages){assert.equal(Object.keys(pg.keys).length,12);assert.equal(Object.keys(pg.dials).length,6)}
assert.equal(p.everyPage.buttons.a.do.native.command,'transport.play')
assert.equal(p.everyPage.buttons.b.do.native.command,'transport.pause')
assert.equal(p.everyPage.buttons.c.do.native.command,'transport.previous')
assert.equal(p.everyPage.buttons.d.do.native.command,'transport.next')
assert.equal(p.everyPage.buttons.keyboard,undefined);assert.equal(p.everyPage.buttons.fnL,undefined)
assert(checkApps({other:{name:'other',target:'native',driver:'windows-media'}}).length)
assert(checkApps({spotify:{name:'Spotify',target:'native',driver:'arbitrary'}}).length)
console.log('PASS Spotify: exact capabilities, real feedback contract, stale track/expiry, no retries, shared modifiers and two complete pages')

let release,calls=0
const blocked=createSpotifyClient({win:{spotify:()=>{calls++;return new Promise(r=>release=r)}}})
await blocked.refresh();assert(!blocked.connected());assert.match(blocked.state().detail,/timed out/)
await blocked.refresh();assert.equal(calls,1);assert.match(blocked.state().detail,/previous request/)
release(JSON.stringify({ok:false,error:'No session'}));await new Promise(r=>setImmediate(r));blocked.stop()
console.log('PASS stalled media helper: bounded timeout, no duplicate queued requests')
