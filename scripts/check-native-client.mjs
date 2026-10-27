import assert from 'node:assert/strict'
import http from 'node:http'
import {nativeWorkspacePage} from '../host/workspace-pages.mjs'
import {createNativeClient,checkNativeAction,checkNativeState} from '../host/native-client.mjs'
import {dialFeedback} from '../host/dial-feedback.mjs'
import {keyFeedback} from '../host/key-feedback.mjs'
const profile={followWorkspace:true,pages:[{nativeWorkspace:'Layout'},{nativeWorkspace:'Geometry Nodes'}]}
assert.equal(nativeWorkspacePage(profile,'Geometry Nodes',0),1);assert.equal(nativeWorkspacePage(profile,'Unknown',0),null);assert.equal(nativeWorkspacePage({...profile,followWorkspace:false},'Layout',1),null)
let clock=10000, writes=[], fail=false
const endpoint={appId:'blender',port:0,pid:process.pid,token:'a'.repeat(40),sessionId:'session-1'}
let state={appId:'blender',sessionId:'session-1',contextId:'object-1',workspace:'Layout',parameters:[{id:'x',label:'POSITION X',type:'float',value:1,min:-10,max:10,step:.1,default:0,unit:'m'}],actions:['transport.stop','workspace.layout'],playing:false}
const server=http.createServer(async(req,res)=>{
 if(req.headers.authorization!==`Bearer ${endpoint.token}`){res.writeHead(401).end();return}
 if(req.url==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return}
 let body='';for await(const part of req)body+=part
 const action=JSON.parse(body);writes.push(action)
 if(fail){res.writeHead(503).end();return}
 if(action.contextId!==state.contextId){res.end(JSON.stringify({ok:false,error:'stale'}));return}
 res.end(JSON.stringify({ok:true}))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));endpoint.port=server.address().port
const client=createNativeClient({appId:'blender',endpointFile:'E:/test/endpoint.json',now:()=>clock,read:()=>JSON.stringify(endpoint)})
try {
 assert(checkNativeAction({verb:'turn',slot:1},true));assert(!checkNativeAction({verb:'turn',slot:7},true));assert(!checkNativeAction({verb:'command',command:'eval',code:'x'}))
 assert(!checkNativeAction({verb:'command',command:'transport.stop'},true));assert(!checkNativeAction({verb:'reset',parameter:'x'},true))
 await client.refresh();assert(client.connected())
 const action=client.capture({verb:'turn',slot:1});assert.equal(action.parameter,'x')
 await client.act(action,2,'fine');assert.equal(writes[0].mode,'fine');assert.equal(writes[0].parameter,'x')
 const d=dialFeedback({page:{dials:{TL:{turn:{native:{verb:'turn',slot:1}}}}},nativeClient:client}).TL
 assert.equal(d.label,'POSITION X');assert.equal(d.text,'1 m');assert.equal(d.norm,.55);assert.equal(d.presentation.state,'confirmed')
 const k=keyFeedback({page:{keys:{0:{do:{native:{verb:'command',command:'transport.toggle'}}}}},nativeClient:client})[0]
 assert.equal(k.enabled,false)
 state.contextId='object-2';await client.refresh();await assert.rejects(client.act(action,1,'normal'),/context changed/);assert.equal(writes.length,1)
 let next=client.capture({verb:'turn',slot:1});endpoint.token='b'.repeat(40);await assert.rejects(client.act(next,1,'normal'),/restarted/);assert.equal(writes.length,1)
 await client.refresh();next=client.capture({verb:'turn',slot:1});await assert.rejects(client.act(next,Infinity,'normal'),/Invalid/);await assert.rejects(client.act(next,321,'normal'),/Invalid/)
 clock+=2600;assert(!client.connected());assert.equal(client.capture({verb:'turn',slot:1}),null)
 assert.equal(dialFeedback({page:{dials:{TL:{name:'X',turn:{native:{verb:'turn',slot:1}}}}},nativeClient:client}).TL.available,false)
 await client.refresh();next=client.capture({verb:'turn',slot:1});fail=true;await assert.rejects(client.act(next,1,'normal'),/503/);assert.equal(writes.length,2)
 const bad=structuredClone(state);bad.parameters[0].value=100;assert.throws(()=>checkNativeState(bad,endpoint),/range/)
 client.stop();assert(!client.connected());await client.refresh();assert(!client.connected())
 console.log('PASS native adapter: identity, auth, selected parameter, stale context/session, fine mode, bounds, truthful feedback, no retry, stop')
} finally {client.stop();await new Promise(r=>server.close(r))}
