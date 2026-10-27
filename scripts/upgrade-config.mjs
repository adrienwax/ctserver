import { upgradeConfig } from '../host/config-upgrade.mjs'
const [shipped, user, version] = process.argv.slice(2)
if (!shipped || !user) throw new Error('Usage: node scripts/upgrade-config.mjs <shipped config> <user config> [version]')
const report = upgradeConfig({ shipped, user, version })
for (const { file, status } of report.files) console.log(`${status.padEnd(10)} ${file}`)
if (report.files.some(x => x.status === 'preserved')) console.log('Your mappings were kept. New defaults are available in .updates/incoming; see .updates/report.json.')
