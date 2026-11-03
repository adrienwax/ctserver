import fs from 'node:fs';import path from 'node:path';
export function initHomeCandidate(app,appDir){
 const installer = app.isPackaged && JSON.parse(fs.readFileSync(path.join(appDir,'package.json'),'utf8')).localCandidate === true;
 const value=process.env.WAXYCT_HOME_CANDIDATE_ROOT || (installer ? path.join(app.getPath('appData'),'CTserver KRAB Candidate') : '');if(!value)return false;
 const root=path.resolve(value);if(!installer&&!/^E:[\\/]/i.test(root))throw Error('Home candidate requires an E-drive private root');
 for(let p=root;;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Redirected candidate path');if(path.dirname(p)===p)break;}
 const profile=path.join(root,'private-profile');for(const p of [profile,path.join(profile,'config'),path.join(root,'router.json')])if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Redirected private candidate path');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
 process.env.WAXYCT_CONFIG=path.join(profile,'config');process.env.WAXYCT_ROUTER_CONFIG=path.join(root,'router.json');process.env.WAXYCT_ROUTER_DATA=path.join(root,'router-data');
 process.env.WAXYCT_HOME_CANDIDATE_ROOT=root;
 if(installer&&!fs.existsSync(process.env.WAXYCT_ROUTER_CONFIG))fs.writeFileSync(process.env.WAXYCT_ROUTER_CONFIG,JSON.stringify({port:9994,hostAuto:false}),{flag:'wx'});
 if(!fs.existsSync(process.env.WAXYCT_ROUTER_CONFIG))throw Error('Candidate router configuration missing');
 const router=JSON.parse(fs.readFileSync(process.env.WAXYCT_ROUTER_CONFIG,'utf8'));
 if(router.port!==9994||router.hostAuto!==false||Object.keys(router).some(k=>!['port','hostAuto'].includes(k)))throw Error('Candidate requires its dedicated port and manual device ownership');
 return true;
}
