import {execFileSync} from 'node:child_process'
const checks=['check-project-library','check-temporal-profile','check-profile-picker-model','check-profile-activation','check-passive-profile','check-td-queued-knobs','check-native-contract-runner','check-rotary-modifiers','check-dial-feedback','check-layout','check-router-ui','check-deck-startup','check-colour-tokens','check-ui-unification']
for(const name of checks) {
 try { const output=execFileSync(process.execPath,[`scripts/${name}.mjs`],{stdio:'pipe',encoding:'utf8',windowsHide:true})
 console.log(name+': '+output.trim().split('\n').slice(-1))
 } catch(error) { process.exitCode=1;console.error(name+' FAILED: '+String(error.stderr||error.message).split('\n').slice(0,16).join('\n')) }
}