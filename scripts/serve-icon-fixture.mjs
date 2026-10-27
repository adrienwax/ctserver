import {configuredInventory} from '../host/profiles.mjs'
import {createProjectLibrary} from '../host/project-library.mjs'
// Isolated UI fixture: no router import, CT ownership, Windows input, or installed config writes.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadIcons, saveIcon, prepareIconFolder } from '../host/icon-library.mjs'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url))), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'waxyct-icon-fixture-'))
let fitState=null
process.on('message',m=>{if(process.env.WAXYCT_FIXTURE_FIT==='1'&&m?.type==='fit-state'){fitState=m.data;if(process.connected)process.send({type:'fit-state-set'})}})
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if(process.env.WAXYCT_FIXTURE_DISCONNECTED==='1'&&url.pathname==='/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});const data=fitState||{now:Date.now(),usb:{present:false,port:null},replug:{},claim:null,procs:{edena:[],edenaMain:null,bridges:[],loupedeck:[]},td:{ok:null,detail:'not checked'},power:{suspend:null,hub:null},hooks:{bridge:false,edena:false},edena:{kind:'unavailable',cmd:'',hooks:false},busy:null,target:null,steps:[],error:null,test:null,autostart:false,children:{host:null,bridge:null,probe:null},host:null,configuration:configuredInventory(path.join(root,'config')),build:{version:'fixture',commit:'disconnected',label:'CT Home r03 candidate'},note:''};res.write('event: status\ndata: '+JSON.stringify(data)+'\n\n');return;}
  if(req.method==='GET'&&url.pathname==='/api/projects')return json(res,createProjectLibrary({configDir:path.join(root,'config'),processes:()=>{throw Error('No process inspection in fixture')},launch:()=>{throw Error('No launch in fixture')}}).list());
  if (req.method === 'GET' && url.pathname === '/api/icons') return json(res, { ...loadIcons(scratch), scratch: true })
  if (req.method === 'GET' && url.pathname === '/api/apps') return json(res, JSON.parse(fs.readFileSync(path.join(root, 'config/apps.json'))))
  if (req.method === 'GET' && url.pathname === '/api/profiles') return json(res, Object.fromEntries(fs.readdirSync(path.join(root, 'config/profiles')).filter(n => n.endsWith('.json')).map(n => [n.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'config/profiles', n)))])))
  if (req.method === 'POST') {
    let text = ''; req.on('data', chunk => { text += chunk; if (text.length > 200000) req.destroy() })
    req.on('end', () => {
      try {
        const body = JSON.parse(text || '{}')
        if(process.env.WAXYCT_FIXTURE_DISCONNECTED==='1'&&url.pathname==='/api/profile'&&body.text===undefined&&/^[a-z0-9-]+$/.test(body.id||''))return json(res,{text:fs.readFileSync(path.join(root,'config/profiles',body.id+'.json'),'utf8')});
        if(process.env.WAXYCT_FIXTURE_DISCONNECTED==='1'&&process.connected)process.send({type:'unexpected-command',url:url.pathname,body});
        if (url.pathname === '/api/icon') return json(res, { ...saveIcon(scratch, body.name, body.lines, body.reset === true), scratch: true })
        if (url.pathname === '/api/open-icons') return json(res, { folder: prepareIconFolder(scratch) })
        json(res, { error: 'No device actions in this scratch fixture.' }, 400)
      } catch (error) { json(res, { error: error.message }, 400) }
    }); return
  }
  const relative = url.pathname === '/' ? 'ui/index.html' : url.pathname.startsWith('/host/') ? url.pathname.slice(1) : 'ui/' + url.pathname.replace(/^\/ui\//, '').replace(/^\//, '')
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end() }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(file))
})
const port = Number(process.env.WAXYCT_FIXTURE_PORT || 5178)
server.listen(port, '127.0.0.1', () => console.log(`Icon scratch fixture: http://127.0.0.1:${port}/?mock · writes only ${scratch}`))
const close = () => server.close(() => { fs.rmSync(scratch, { recursive: true, force: true }); process.exit(0) })
process.on('SIGINT', close); process.on('SIGTERM', close)

// The owned browser fixture can close normally on Windows without terminating its process.
process.on('message', message => { if (message === 'close') close() })
