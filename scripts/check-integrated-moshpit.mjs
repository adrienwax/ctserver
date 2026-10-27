import {ensureScratch,configureToolCaches} from './build-scratch/bootstrap.mjs'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
configureToolCaches(ensureScratch('build'))
const root=process.env.WAXYCT_MOSHPIT_SRC
if(!root||!fs.existsSync(root+'/engine/src/control/server.ts')||!fs.existsSync(root+'/node_modules/esbuild/lib/main.js'))throw Error('Set WAXYCT_MOSHPIT_SRC to the reviewed Moshpit checkout with its existing dependencies')
for(const script of ['check-moshpit-real.mjs','check-moshpit-contract.mjs']){
 const output=execFileSync(process.execPath,['scripts/'+script,root],{encoding:'utf8',env:process.env})
 if(output.includes('skipped:'))throw Error('Required integration check skipped: '+script)
 console.log(output.trim())
}
