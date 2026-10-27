import {ensureScratch} from './build-scratch/bootstrap.mjs'
ensureScratch('build')
for(const name of ['check-ui-unification','check-manual-assignment','check-editor-review-followup','check-cross-profile-history','check-file-history','check-manual-assignment-browser','check-ui-fields-browser','check-home-disconnected-ui','check-home-boundary','check-profile-activation']) {console.log('CHECK '+name);await import('./'+name+'.mjs')}
console.log('CT editor final focused regressions PASS')
