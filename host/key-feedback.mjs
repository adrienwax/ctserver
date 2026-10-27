// Pure key readback. Selection is not enablement; missing data is never OFF.
import {keyBindingKey} from '../ui/control-presentation.mjs'
import {ctResolve} from './moshpit-client.mjs'
import {rigStateMatches} from './td-contract.mjs'
export function keyFeedback({page={},profile={},client=null,nativeClient=null,selection=0,bank=0,tdState=null,tdOk=false,apps={},profiles={},view={},running={},lastOfApp={}}={}) {
 const result={}
 for(const [slot,key] of Object.entries(page.keys||{})) {
  const td=key.do?.td, mp=key.do?.moshpit
  let kind='plain',state='unavailable',enabled=null,selected=null
  const tdFresh=tdOk&&rigStateMatches(profile,tdState)
  if(key.do?.native){
   const a=key.do.native,p=nativeClient?.parameter(a),s=nativeClient?.state()
   if(a.verb==='toggle'){kind='toggle';if(p?.type==='bool'&&p.available!==false){state='confirmed';enabled=p.value}}
   else if(a.command==='transport.toggle'){kind='toggle';if(typeof s?.playing==='boolean'){state='confirmed';enabled=s.playing}}
   else if(nativeClient?.capture(a)){kind='momentary';state='confirmed'}
  } else if(key.state) {
   kind=typeof key.state.equals==='boolean'?'toggle':'selection'
   const values=tdState?.values, value=values?.[key.state.par]
   const known=tdFresh&&values&&Object.hasOwn(values,key.state.par)&&typeof value===typeof key.state.equals
   if(known){state='confirmed';if(kind==='toggle')enabled=value===key.state.equals;else selected=value===key.state.equals}
  } else if(td?.type==='rigToggle'||td?.type==='rigView') {
   kind='toggle';const v=tdState?.on?.[td.type==='rigView'?'View':td.par]
   if(tdFresh&&typeof v==='boolean'){state='confirmed';enabled=v}
  } else if(td?.type==='rigClip') {
   kind='selection';if(tdFresh&&Number.isFinite(tdState?.clip)){state='confirmed';selected=tdState.clip===td.n}
  } else if(mp?.verb==='toggle') {
   kind='toggle';const a=ctResolve(mp,selection,bank), reading=a&&client?.connected()&&client.reading(a)
   if(reading?.param?.type==='bool'&&typeof reading.value==='boolean'){state='confirmed';enabled=reading.value}
  } else if(mp?.verb==='select') {
   kind='selection'
   if(client?.connected()&&client.syncs()&&Number.isInteger(client.selectedSlot())){state='confirmed';selected=client.selectedSlot()===mp.slot}
  } else if(td?.type==='rigPulse') {kind='momentary'}
  // Host-owned app/profile display facts travel with the same binding identity as readback.
  const appKey=apps[key.do?.app], target=profiles[key.do?.switch]
  const exe=appKey?appKey.exe:target?.app?.exe
  const active=appKey?profile.appId===key.do.app:target?target.id===view.profile||!!(profile.pick&&lastOfApp[profile.appId]===target.id):enabled===true||selected===true
  const dim=!!(exe&&!running[exe]&&!target?.handoff&&appKey?.target!=='handoff')
  result[slot]={kind,state,enabled,selected,bindingKey:keyBindingKey(key),display:{active,dim}}
 }
 return result
}
