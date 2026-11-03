const fs=require('node:fs');const path=require('node:path');
module.exports=async context=>{
 const resources=path.join(context.appOutDir,'resources'),ct=path.join(resources,'ct');
 const from=path.join(ct,'modules'),to=path.join(ct,'node_modules');
 if(!fs.existsSync(from)||fs.existsSync(to))throw Error('Unexpected staged CT dependency layout');
 fs.renameSync(from,to);
 const pkg=JSON.parse(fs.readFileSync(path.join(resources,'app','package.json'),'utf8'));
 if(pkg.localCandidate){
  const file=path.join(resources,'app','config','apps.json');
  const apps=JSON.parse(fs.readFileSync(file,'utf8'));
  apps.moshpit.exe='Moshpit KRAB Candidate.exe';
  apps.moshpit.endpointFile='%APPDATA%/Moshpit KRAB Candidate/control-endpoint.json';
  fs.writeFileSync(file,JSON.stringify(apps,null,2)+'\n');
 }
};
