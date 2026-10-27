import fs from 'node:fs';import path from 'node:path';
export function initHomeCandidate(app,appDir){
 const value=process.env.WAXYCT_HOME_CANDIDATE_ROOT;if(!value)return false;
 const root=path.resolve(value);if(!/^E:[\\/]/i.test(root))throw Error('Home candidate requires an E-drive private root');
 for(let p=root;;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Redirected candidate path');if(path.dirname(p)===p)break;}
 const profile=path.join(root,'private-profile');for(const p of [profile,path.join(profile,'config'),path.join(root,'router.json')])if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Redirected private candidate path');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
 process.env.WAXYCT_CONFIG=path.join(profile,'config');process.env.WAXYCT_ROUTER_CONFIG=path.join(root,'router.json');process.env.WAXYCT_ROUTER_DATA=path.join(root,'router-data');
 if(!fs.existsSync(process.env.WAXYCT_ROUTER_CONFIG))throw Error('Candidate router configuration missing');
 const router=JSON.parse(fs.readFileSync(process.env.WAXYCT_ROUTER_CONFIG,'utf8'));
 if(router.port!==9994||router.hostAuto!==false||Object.keys(router).some(k=>!['port','hostAuto'].includes(k)))throw Error('Candidate requires its dedicated port and manual device ownership');
 return true;
}
