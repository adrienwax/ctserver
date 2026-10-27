import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const checks=["scripts/check-source-entrypoints.mjs", "scripts/build-scratch/bootstrap.test.mjs", "scripts/check-editor-release-routes.mjs", "scripts/check-home-boundary.mjs", "scripts/check-profile-activation.mjs", "scripts/check-action-queue.mjs", "scripts/check-wheel-queue.mjs", "scripts/check-rotary-modifiers.mjs", "scripts/check-dial-feedback.mjs", "scripts/check-screen-cache.mjs", "scripts/check-config-upgrade.mjs", "scripts/check-tile-presentation.mjs", "scripts/check-bridge-runtime.mjs"];
execFileSync(process.execPath,['--test',...checks],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
console.log('Public offline checks only: no app, network, native adapter or physical CT acceptance is implied.');
