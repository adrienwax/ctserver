// Truthful application readiness, independent of the profile being edited in the UI.
export function controlContext({ profile, profileId, moshpit, nativeState, tdOk, tdState, tdCheckedAt = 0, tdProfileId, now = Date.now() }) {
  const target = profile?.app?.target || 'system'
  const base = { profileId, appId: profile?.appId || null, target, name: profile?.app?.name || profile?.name || 'Home', checkedAt: now }
  if (target === 'system' || target === 'keys') return { ...base, phase: 'ready', detail: '' }
  if (target === 'native') return {...base,phase:nativeState?.phase||'unavailable',detail:nativeState?.detail||'Start the app adapter'}
  if (target === 'moshpit') return { ...base, phase: moshpit?.phase || 'disconnected', detail: moshpit?.detail || '' }
  if (target !== 'td') return { ...base, phase: 'unknown', detail: 'Application readiness unavailable' }
  if (tdOk === false) return { ...base, phase: 'unreachable', detail: 'TouchDesigner control server unavailable' }
  if (tdProfileId !== profileId || !tdCheckedAt || now - tdCheckedAt > 5000) return { ...base, phase: 'unknown', detail: 'Waiting for current rig feedback' }
  if (!tdState || !Number.isFinite(tdState.clip) || !tdState.on || !tdState.norm || !Array.isArray(tdState.parameters)) return { ...base, phase: 'missing-rig', detail: 'CT_RIG is missing or incompatible' }
  const required = new Set()
  const walk = x => { if (!x || typeof x !== 'object') return; if (x.td?.par) required.add(x.td.par); if (x.state?.par) required.add(x.state.par); if (x.td?.type === 'rigFrameStep') { required.add('Position'); required.add('Framecount'); required.add('Currentframe') } for (const v of Object.values(x)) if (typeof v === 'object') walk(v) }
  walk(profile)
  if (profile.rigIdentity && tdState.values?.[profile.rigIdentity.parameter] !== profile.rigIdentity.value) return { ...base, phase:'missing-rig', detail:'A different TD project is open' }
  const missing = [...required].filter(par => !tdState.parameters.includes(par))
  return { ...base, phase: missing.length ? 'missing-rig' : 'ready', detail: missing.length ? `Rig lacks ${missing.join(', ')}` : 'Rig feedback verified' }
}
