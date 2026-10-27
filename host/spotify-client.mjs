// Windows media API transport shares the app adapters' stale-context and feedback rules.
import {randomBytes} from 'node:crypto'
import {createNativeClient} from './native-client.mjs'
export function createSpotifyClient({win,now=Date.now}) {
 const endpoint={appId:'spotify',sessionId:'spotify-'+randomBytes(12).toString('hex'),pid:process.pid,port:0,token:randomBytes(24).toString('base64url')}
 let pending=null
 const transport={
  endpoint:()=>endpoint,
  async exchange(route,action){
   if(pending)throw Error('Spotify is still answering the previous request')
   const request=win.spotify({route,action,deadlineUnixMs:now()+1200})
   pending=request
   request.then(()=>{if(pending===request)pending=null},()=>{if(pending===request)pending=null})
   const result=JSON.parse(await request)
   if(!result.ok)throw Error(result.error||'Spotify unavailable')
   return route==='state'?{...result,appId:endpoint.appId,sessionId:endpoint.sessionId}:result
  }
 }
 return createNativeClient({appId:'spotify',transport,now})
}
