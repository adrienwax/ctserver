// A supported TD rig must prove its project identity on the same TD main-thread call
// as the action; a previous poll is not authorization to mutate a different rig.
export function guardRigScript(script, identity) {
  if (!identity) throw new Error('TD profile unavailable: no project identity')
  if (!/^[A-Z][a-z0-9]+$/.test(identity.parameter) || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(identity.value)) throw new Error('Invalid rig identity')
  return `assert str(op('/project1/CT_RIG').par.${identity.parameter}.eval()) == '${identity.value}', 'Different TD project; action refused'\n` + script
}
// Legacy mappings stay editable on disk, but cannot be activated or dispatched.
// Moshpit and Home are app-wide controls and do not require a TD identity.
export function tdProfileSupported(profile) {
  return !!profile && (profile.app?.target !== 'td' || (profile.tier !== 'legacy' && !!profile.rigIdentity))
}
export function rigStateMatches(profile, state) {
  return profile?.rigIdentity ? tdProfileSupported(profile) && state?.values?.[profile.rigIdentity.parameter] === profile.rigIdentity.value : profile?.app?.target !== 'td'
}
export function stateTileActive(key, profile, state, fresh) {
  return !!(key?.state && fresh && rigStateMatches(profile,state) && state?.values && Object.hasOwn(state.values,key.state.par) && state.values[key.state.par] === key.state.equals)
}