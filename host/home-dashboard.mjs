// Home chooses context; only the separate confirmation key may activate it.
export const HOME_ACTIONS = [...['apps','projects','profiles','pages'].flatMap(k=>['browse-'+k,'pick-'+k]),'apps','projects','profiles','pages','guides','setup','device',...Array.from({length:12},(_,i)=>'key'+i)];
const short = value => String(value || '').replace(/[^a-zA-Z0-9 /+.-]/g,' ').trim().toUpperCase().slice(0,10);
const tile=(label,icon,action,color='cyan',extra={})=>({label:short(label),icon,color,do:{home:action},...extra});
export function createHomeDashboard({inventory,request,activate,change=()=>{}}) {
 let mode='home',rows=[],index=0,selected=null,profileId=null,message='',loading=false,busy=false,revision=0;
 const bump=()=>{revision++;change()};
 const current=token=>token===revision;
 const profiles=()=>inventory().profiles.filter(p=>p.id!=='main'&&p.supported&&!p.pick&&p.tier==='current'&&!p.handoff);
 const apps=()=>Object.entries(inventory().apps).flatMap(([appId,app])=>{const candidates=profiles().filter(p=>p.appId===appId);const p=candidates.find(p=>p.id===app.default)||candidates[0];return p?[{id:appId,appId,profileId:p.id,label:app.name,detail:p.name}]:[]});
 function reset(){mode='home';rows=[];selected=null;index=0;message='';loading=false;busy=false;bump()}
 async function choose(next) {
  mode=next;selected=null;index=0;message='';rows=[];loading=next==='projects';busy=false;bump();const token=revision;
  if(next==='apps')rows=apps();
  if(next==='profiles')rows=profiles().map(p=>({...p,label:p.name,detail:inventory().apps[p.appId]?.name||p.appId||'',id:p.id}));
  if(next==='pages') {const p=profiles().find(p=>p.id===profileId);if(p)rows=p.pages.map((name,i)=>({id:p.id+':'+(i+1),profileId:p.id,page:i+1,label:name,detail:p.name}));else message='Choose a profile first';}
  if(next==='projects')try{const r=await request('inventory',{},()=>current(token));if(!current(token))return;rows=(r.projects||[]).filter(r=>profiles().some(p=>p.id===r.profileId)).map(r=>({...r,id:JSON.stringify([r.profileId,r.projectId]),label:r.title,detail:[inventory().apps[r.appId]?.name||r.appId,profiles().find(p=>p.id===r.profileId)?.name,r.reason].filter(Boolean).join(' / ')}));}
  catch(e){if(current(token))message=e.message;}
  if(!current(token))return;loading=false;if(!rows.length&&!message)message='No '+next+' available';bump();return revision;
 }
 function move(delta){if(!rows.length||busy||loading)return;index=Math.max(0,Math.min(rows.length-1,index+Math.sign(delta)*Math.min(100,Math.abs(delta))));selected=null;message='';bump()}
 function select(){if(!rows[index]||busy||loading)return;selected={...rows[index]};message=[selected.label,selected.detail,mode==='projects'?'Open launches this exact project':mode==='apps'?'Open activates this app and its controls':mode==='profiles'?'Use selects controls only':'Enter activates this exact workspace'].filter(Boolean).join(' / ');bump()}
 async function confirm(){
  if(!selected||busy||loading)return;const row=selected,kind=mode;
  if(kind==='projects'&&(!row.canOpen||row.status!=='ready'||!row.projectId)){message=row.reason||'Project unavailable';bump();return;}
  if(kind==='apps'&&!apps().some(a=>a.id===row.id&&a.profileId===row.profileId))return reset();
  if(kind==='profiles'&&!profiles().some(p=>p.id===row.id))return reset();
  if(kind==='pages'&&!profiles().some(p=>p.id===row.profileId&&p.pages[row.page-1]===row.label))return reset();
  busy=true;bump();const token=revision;
  try {
   if(kind==='projects'){const r=await request('open',{profileId:row.profileId,projectId:row.projectId},()=>current(token));if(!current(token))return;if(!r.ok)throw Error(r.error||'Project opening refused');message='Project opening requested';selected=null;}
   if(kind==='apps'){profileId=row.profileId;await activate(row.profileId,undefined,false,()=>current(token),'app');if(!current(token))return;reset();return;}
   if(kind==='profiles'){profileId=row.id;await activate(row.id,undefined,true,()=>current(token));if(!current(token))return;reset();return;}
   if(kind==='pages'){await activate(row.profileId,row.page,false,()=>current(token));if(!current(token))return;reset();return;}
  }catch(e){if(!current(token))return;message=e.message;selected=null;}
  if(current(token)){busy=false;bump();}
 }
 async function action(value,delta=0){
  if(!HOME_ACTIONS.includes(value))return;
  const dial=/^(browse|pick)-(apps|projects|profiles|pages)$/.exec(value);
  if(dial){
   if(busy||loading)return;
   if(mode!==dial[2]){const token=await choose(dial[2]);if(!current(token))return;}
   if(dial[1]==='browse'){if(Number.isSafeInteger(delta)&&delta)move(delta)}else select();
   return;
  }
  if(value.startsWith('key')){const n=Number(value.slice(3));if(mode==='home')return;const start=Math.floor(index/6)*6;
   if(n<6&&rows[start+n]&&!busy){index=start+n;return select()};if(n===6)return move(-6);if(n===7)return move(6);if(n===8)return reset();if(n===10)return confirm();if(n===11)return choose(mode);return;}
  if(['apps','projects','profiles','pages'].includes(value))return choose(value);
  if(['guides','setup','device'].includes(value)){if(busy)return;busy=true;bump();const token=revision;try{const r=await request(value,{},()=>current(token));if(current(token)){message=r.error||r.message||'';busy=false;bump()}}catch(e){if(current(token)){message=e.message;busy=false;bump()}}}
 }
 function snapshot(base) {
  const keys={};let title='Home',detail=message;
  if(mode==='home'){Object.assign(keys,base.keys);const state=inventory();detail=message||('Selected profile: '+(profiles().find(p=>p.id===profileId)?.name||'none')+' / '+Object.values(state.apps).filter(a=>a&&typeof a==='object'&&a.name).map(a=>a.name+': '+(a.running===true?'running':a.running===false?'not running':'unknown')).join(' / '));
   if(keys['8'])keys['8']={...keys['8'],color:state.connected===true?'sage':'sand'};detail+=' / Device: '+(state.connected===true?'connected':state.connected===false?'disconnected':'unknown');
  } else {
   title=mode[0].toUpperCase()+mode.slice(1);const start=Math.floor(index/6)*6;
   rows.slice(start,start+6).forEach((r,i)=>keys[i]=tile(r.label,r.appId==='moshpit'?'mosh':mode==='pages'?'layers':'clip','key'+i,r.appId==='moshpit'?'coral':'cyan'));
   keys[6]=tile('PREVIOUS','back','key6','sand');keys[7]=tile('NEXT','more','key7','sand');keys[8]=tile('HOME','home','key8','bone');
   if(selected)keys[10]=tile(busy?'WAIT':['projects','apps'].includes(mode)?'OPEN':mode==='profiles'?'USE':'ENTER',mode==='projects'?'import':'play','key10',busy||mode==='projects'&&!selected.canOpen?'dust':'sage');
   keys[11]=tile('REFRESH','loop','key11','sand');
   detail=message||(loading?'Checking project links...':rows[index]?[rows[index].label,rows[index].detail].filter(Boolean).join(' / '):'No choices');
  }
  const dialFeedback={};
  for(const [id,d] of Object.entries(base.dials||{})){
   const match=/^browse-(apps|projects|profiles|pages)$/.exec(d.turn?.home||'');if(!match)continue;
   const active=mode===match[1],text=active?(loading?'WAIT':rows.length?String(index+1)+'/'+rows.length:'EMPTY'):'BROWSE';
   dialFeedback[id]={label:d.name,text,norm:null,available:!busy&&!loading,presentation:{state:'confirmed',kind:'text',valueText:text,unit:''}};
  }
  const page={...base,name:title,keys};
  if(mode!=='home')page.wheel={turn:{home:'key7'},tap:{home:'key0'}};
  return {revision,mode,dialFeedback,selectedProfile:profileId,detail,loading,busy,index,total:rows.length,highlight:mode==='home'?null:index%6,selected:!!selected,page,
   wheel:mode==='home'?null:{label:'BROWSE',homeDetail:detail,text:rows.length?String(index+1)+'/'+rows.length:'EMPTY',available:true,presentation:{state:'confirmed',valueText:rows.length?String(index+1)+'/'+rows.length:'EMPTY',unit:'',kind:'text'}}};
 }
 return {action,move,select,reset,snapshot,setProfile(id){if(profiles().some(p=>p.id===id))profileId=id;},invalidate:reset};
}
