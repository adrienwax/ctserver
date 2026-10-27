// Bootstrap before importing any check: os.tmpdir() and child cache paths must
// already belong to the managed E run. Normal start/serve remain untouched.
import { ensureScratch, configureToolCaches } from './build-scratch/bootstrap.mjs'

const mode = process.argv[2] || 'test'
if (!['test', 'persistence'].includes(mode)) throw new Error(`Unknown offline check: ${mode}`)
configureToolCaches(ensureScratch('build'))
await import(mode === 'persistence' ? './check-config-upgrade.mjs' : './test-public.mjs')
