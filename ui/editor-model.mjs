/** Shared pure presentation and edit-identity rules. No routing or device writes. */
export function actionIdentity(action, scope = '') {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
  return `${scope}:${JSON.stringify(stable(action))}`
}
export function bindingTarget(edit, key, trigger, revision) {
  return { profile: edit.profile, page: edit.page, key, trigger, revision }
}
export function sameBindingTarget(target, edit, key, trigger, revision) {
  return !!target && target.profile === edit.profile && target.page === edit.page && target.key === key && target.trigger === trigger && target.revision === revision
}
export function applyActionAppearance(control, item) {
  if (item.label !== undefined) control.label = item.label
  if (item.color) control.color = item.color
  if (control.iconSource !== 'custom') {
    if (item.icon) control.icon = item.icon
    else delete control.icon
    control.iconSource = 'auto'
  }
  // This described the previous action; live feedback belongs to the host.
  delete control.sub
  return control
}
export function controlledAppStatus(snapshot, online = true, at = Date.now()) {
  if (!online || !snapshot?.host || (snapshot.now && at - snapshot.now > 12000)) return { text: 'Control link unavailable', kind: 'warn', detail: 'Waiting for current controller status.' }
  if (snapshot.busy) return { text: 'Switching controls', kind: '', detail: snapshot.busy }
  const host = snapshot.host
  const profile = (host.profiles || []).find(p => p.id === host.profile)
  const app = (host.apps || []).find(a => a.id === profile?.appId)
  const context = host.controlContext || { target: host.profile === 'main' ? 'system' : app?.target, appId: profile?.appId, name: app?.name, phase: app?.target === 'moshpit' ? host.moshpit?.[profile.appId]?.phase : 'unknown' }
  if (context.target === 'system') return { text: '', kind: '', detail: '' }
  if (snapshot.claim?.owner !== 'waxyct') return { text: 'App controls inactive', kind: '', detail: 'waxyct does not currently hold the CT.' }
  const stale = context.checkedAt && at - context.checkedAt > 12000
  const phase = stale ? 'unknown' : context.phase
  const state = { connected: 'Connected', ready: 'Ready', connecting: 'Connecting', waiting: 'Waiting', error: 'Error', unreachable: 'Unavailable', 'missing-rig': 'Rig unavailable', unknown: 'Checking', disconnected: 'Disconnected' }[phase] || 'Disconnected'
  const name = context.name || (context.target === 'moshpit' ? 'Moshpit' : context.target === 'td' ? 'TouchDesigner' : 'App')
  return { text: `${name} · ${state}`, kind: ['connected', 'ready'].includes(phase) ? 'ok' : ['connecting','unknown'].includes(phase) ? '' : 'warn', detail: stale ? 'Waiting for fresh app feedback.' : context.detail || '' }
}

// Reuse supported bindings already present in this profile; never invent adapter capabilities.
export function profileControlActions(profile, app = 'profile') {
  const items = new Map()
  for (const body of [profile?.everyPage, ...(profile?.pages || [])].filter(Boolean)) {
    const controls = [...Object.values(body.keys || {}), ...Object.values(body.dials || {}), ...Object.values(body.buttons || {}), ...(body.wheel ? [body.wheel] : [])]
    for (const control of controls) for (const trigger of ['do', 'hold', 'redo', 'turn', 'press', 'tap']) {
      const act = control[trigger], native = act?.native
      if (!(native || act?.moshpit || act?.td) || native?.command?.startsWith('workspace.')) continue
      const id = actionIdentity(act, app)
      if (items.has(id)) continue
      const binding = native || act.moshpit || act.td
      const target = binding.command || binding.parameter || binding.par || binding.path || ('Parameter ' + (binding.slot || binding.bank || ''))
      const label = control.name || control.label || target.replaceAll('.', ' ')
      const verb = {turn:'Turn',reset:'Reset',toggle:'Toggle',command:'Action'}[binding.verb] || (trigger === 'turn' ? 'Turn' : 'Press')
      items.set(id, {id, app, category:'App controls', icon:control.icon || (binding.verb === 'reset' ? 'reset' : 'effect'), color:control.color || profile.color || 'bone', name:label + ' · ' + verb, label:label.toUpperCase().slice(0,10), trig:trigger === 'turn' ? 'turn' : 'press', act:structuredClone(act)})
    }
  }
  return [...items.values()]
}
export function withPageControlScope(profile, index, kind, slot, onlyThisPage) {
  const result = structuredClone(profile), page = result.pages[index]
  const section = {key:'keys',dial:'dials',button:'buttons'}[kind]
  const shared = kind === 'wheel' ? result.everyPage?.wheel : result.everyPage?.[section]?.[slot]
  if (!page || !shared) throw Error('This control has no shared mapping')
  if (kind === 'wheel') { if (onlyThisPage) page.wheel = structuredClone(shared); else delete page.wheel }
  else if (onlyThisPage) { page[section] ||= {}; page[section][slot] = structuredClone(shared) }
  else if (page[section]) { delete page[section][slot]; if (!Object.keys(page[section]).length) delete page[section] }
  return result
}

// New assignments need a value; legacy profile files remain loadable without migration.
export function assignmentProblem(action) {
  if (action?.type !== undefined && (typeof action.type !== 'string' || !action.type.length)) return 'Enter text to type before binding this control.'
  if (action?.focus !== undefined && (typeof action.focus !== 'string' || !action.focus.trim())) return 'Enter a program file name, such as Spotify.exe.'
  return null
}
