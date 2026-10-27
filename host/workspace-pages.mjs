// Optional navigation feedback only selects an existing owner page; it never edits a profile
// or sends an enter command back. Old/custom profiles opt in with followWorkspace: true.
export const WORKSPACES = ['home', 'browse', 'mosh', 'node', 'render', 'settings']
export const pageWorkspace = page => {
  const action = page?.enter?.moshpit
  return action?.verb === 'command' && action.command?.startsWith('workspace.') ? action.command.slice(10) : null
}
export function workspacePage(profile, workspace, current = 0, remembered = {}) {
  if (profile?.followWorkspace !== true || !WORKSPACES.includes(workspace)) return null
  const pages = profile.pages || []
  const wanted = workspace === 'node' && !pages.some(p => pageWorkspace(p) === 'node') ? 'mosh' : workspace
  const matches = (p, i) => pageWorkspace(p) === wanted || (wanted === 'home' && i === 0 && !p.enter)
  if (pages[current] && matches(pages[current], current)) return current
  const last = remembered[wanted]
  if (pages[last] && matches(pages[last], last)) return last
  const index = pages.findIndex(matches)
  return index < 0 ? null : index // Settings, or an owner-removed page: leave the CT alone.
}

// Exact declared app workspace identity; following never sends another enter action.
export function nativeWorkspacePage(profile,workspace,current=0,initial=false) {
  if((!initial&&profile?.followWorkspace!==true)||typeof workspace!=='string'||!workspace)return null
  const pages=profile.pages||[]
  if(pages[current]?.nativeWorkspace===workspace)return current
  const found=pages.findIndex(p=>p.nativeWorkspace===workspace)
  return found<0?null:found
}
