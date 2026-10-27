// Searchable profile inventory. Selection edits/activates a profile; opening its project is separate.
'use strict';
(() => {
  const text = value => typeof value === 'string' ? value : value == null ? '' : String(value)
  const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const parked = item => item?.tier === 'parked' || item?.parked === true
  const legacy = item => item?.tier === 'legacy'
  const keyOf = row => JSON.stringify([row.profileId, row.projectId || ''])
  const reasons = {
    ready: 'Ready to open', missing: 'Project or application not found', unsupported: 'Opening this project is not supported',
    unconfigured: 'No project linked', changed: 'Project identity changed; review its link', busy: 'Another project open request is in progress',
  }
  function rowsFor(profiles = [], projects = [], apps = [], includeLegacy = false) {
    const appById = new Map(apps.map(a => [a.id, a]))
    return profiles.filter(p => !p.pick && !parked(p) && !parked(appById.get(p.appId)) &&
      (includeLegacy || (!legacy(p) && !legacy(appById.get(p.appId))))).flatMap(p => {
      const linked = projects.filter(row => row.profileId === p.id)
      return (linked.length ? linked : [{profileId:p.id, status:'unconfigured', canOpen:false}]).map(project => {
        const app = appById.get(project.appId || p.appId)
        const row = {
          ...project, profileId:p.id, projectId:text(project.projectId), profileName:text(p.name || p.id),
          title:text(project.title), appId:text(project.appId || p.appId), appName:text(app?.name || project.appId || p.appId || 'Home'),
          author:text(project.author || p.author), version:text(project.version || p.version),
          status: reasons[project.status] ? project.status : 'unconfigured',
          isLegacy:legacy(p) || legacy(app),
        }
        row.key = keyOf(row)
        row.reason = text(project.reason) || reasons[row.status]
        row.canOpen = project.canOpen === true && row.status === 'ready' && !!row.projectId
        return row
      })
    }).sort((a,b) => (b.profileId === 'main') - (a.profileId === 'main') || a.appName.localeCompare(b.appName) || a.profileName.localeCompare(b.profileName) || a.title.localeCompare(b.title))
  }
  function searchRows(rows, query = '') {
    const terms = text(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    return rows.filter(row => terms.every(term => [row.profileName,row.title,row.appName,row.author,row.version,row.profileId,row.projectId,row.isLegacy ? 'legacy' : ''].join(' ').toLocaleLowerCase().includes(term)))
  }
  function openAllowed(row, {mock = false, online = false, loading = false, error = '', opening = false} = {}) {
    return !!row && !mock && online && !loading && !error && !opening && row.canOpen === true && row.status === 'ready' && !!row.projectId
  }
  function mount(root, {onSelect, onRefresh, onOpen, mock = false, icon = () => ''}) {
    root.innerHTML = `<div class="profile-picker"><button type="button" class="profile-picker-toggle" aria-expanded="false" aria-controls="profile-picker-popup"><span class="profile-picker-icon" aria-hidden="true"></span><span class="profile-picker-current">Choose profile</span><span aria-hidden="true">⌄</span></button><div class="profile-picker-popup" id="profile-picker-popup" hidden><div class="profile-picker-search"><input id="profile-picker-search" type="search" role="combobox" aria-label="Search profiles and projects" aria-autocomplete="list" aria-expanded="false" aria-controls="profile-picker-options" placeholder="Search profiles, projects, authors…" autocomplete="off"><button type="button" class="act bar" data-refresh aria-label="Refresh projects">Refresh</button></div><div class="profile-picker-count" role="status"></div><div class="profile-picker-options" id="profile-picker-options" role="listbox" aria-label="Profiles and projects"></div></div></div><div class="profile-project-meta"></div><button type="button" class="act bar profile-project-open" disabled>Open project</button><span class="profile-project-state" role="status"></span>`
    const get = selector => root.querySelector(selector)
    const toggle = get('.profile-picker-toggle'), popup = get('.profile-picker-popup'), input = get('input')
    const options = get('.profile-picker-options'), open = get('.profile-project-open'), status = get('.profile-project-state')
    let state = {rows:[], selectedProfile:null, online:false, loading:false, error:''}, chosenKey = '', activeKey = '', filtered = [], opening = false, message = '', lastRows = ''
    function selected() { return state.rows.find(r => r.profileId === state.selectedProfile && r.key === chosenKey) || state.rows.find(r => r.profileId === state.selectedProfile) }
    function close(restoreFocus = false) {
      popup.hidden = true; toggle.setAttribute('aria-expanded','false'); input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant')
      if (restoreFocus) toggle.focus()
    }
    function show() {
      popup.hidden = false; toggle.setAttribute('aria-expanded','true'); input.setAttribute('aria-expanded','true')
      input.value = ''; activeKey = selected()?.key || ''; renderRows(); input.focus(); onRefresh?.()
    }
    function renderRows() {
      filtered = searchRows(state.rows,input.value)
      if (!filtered.some(row => row.key === activeKey)) activeKey = filtered[0]?.key || ''
      const html = filtered.map((row,index) => `<div id="profile-option-${index}" class="profile-picker-option${row.key === activeKey ? ' active' : ''}" role="option" aria-selected="${row.key === selected()?.key}" data-option="${index}"><span class="profile-option-icon" aria-hidden="true">${icon(row.appId)}</span><span class="profile-option-copy"><strong>${esc(row.profileName)}</strong>${row.title ? `<span>${esc(row.title)}</span>` : ''}<small>${esc([row.appName,row.author,row.version && `v${row.version}`,row.isLegacy && 'Legacy'].filter(Boolean).join(' / '))}</small></span><span class="profile-option-status">${esc(row.reason)}</span></div>`).join('')
      // Preserve scroll and the search input itself when snapshots arrive while typing.
      if (html !== lastRows) { const scroll = options.scrollTop; options.innerHTML = html || '<div class="profile-picker-empty">No matching profiles or projects.</div>'; options.scrollTop = scroll; lastRows = html }
      const index = filtered.findIndex(row => row.key === activeKey)
      if (index >= 0 && !popup.hidden) input.setAttribute('aria-activedescendant',`profile-option-${index}`); else input.removeAttribute('aria-activedescendant')
      get('.profile-picker-count').textContent = state.error || (state.loading ? 'Checking project links…' : `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}${mock ? ' · Browser demo — opening disabled' : ''}`)
    }
    function render() {
      const row = selected()
      get('.profile-picker-current').textContent = row?.profileName || 'Choose profile'
      get('.profile-picker-icon').innerHTML = icon(row?.appId)
      get('.profile-project-meta').textContent = row ? [row.title,row.appName,row.author,row.version && `v${row.version}`].filter(Boolean).join(' / ') : ''
      open.disabled = !openAllowed(row,{...state,mock,opening})
      open.textContent = opening ? 'Opening…' : 'Open project'
      status.textContent = message || (mock ? 'Browser demo · opening disabled' : !state.online ? 'Router offline' : state.error || (state.loading ? 'Checking project links…' : row?.reason || 'Choose a profile'))
      toggle.disabled = !state.rows.length
      if (!popup.hidden) renderRows()
    }
    function choose(row) {
      if (!row) return
      chosenKey = row.key; message = ''; close(true); onSelect(row.profileId); render()
    }
    toggle.addEventListener('click',() => popup.hidden ? show() : close())
    toggle.addEventListener('keydown',event => { if (event.key === 'ArrowDown') { event.preventDefault(); show() } })
    input.addEventListener('input',() => { activeKey = ''; renderRows() })
    input.addEventListener('keydown',event => {
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        let index = filtered.findIndex(row => row.key === activeKey)
        index = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : Math.max(0,Math.min(filtered.length-1,index+(event.key === 'ArrowDown' ? 1 : -1)))
        activeKey = filtered[index]?.key || ''; renderRows(); get(`#profile-option-${index}`)?.scrollIntoView({block:'nearest'})
      } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choose(filtered.find(row => row.key === activeKey)) }
    })
    root.addEventListener('keydown',event => { if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); event.stopPropagation(); close(true) } })
    options.addEventListener('mousedown',event => { if (event.target.closest('[data-option]')) event.preventDefault() })
    options.addEventListener('click',event => { const option = event.target.closest('[data-option]'); if (option) choose(filtered[Number(option.dataset.option)]) })
    get('[data-refresh]').addEventListener('click',() => onRefresh?.())
    document.addEventListener('pointerdown',event => { if (!root.contains(event.target)) close() })
    root.addEventListener('focusout',() => { queueMicrotask(() => { if (!root.contains(document.activeElement)) close() }) })
    open.addEventListener('click',async () => {
      const row = selected()
      // Also guard in code: synthetic clicks and browser fixtures cannot open native projects.
      if (!openAllowed(row,{...state,mock,opening})) return
      const identity = {profileId:row.profileId,projectId:row.projectId}
      opening = true; message = ''; render()
      try {
        const result = await onOpen(identity)
        message = result?.ok ? `${row.title || row.profileName}: project open requested` : text(result?.error || 'Project could not be opened')
      } catch { message = 'Router did not answer. Check Diagnose before retrying.' }
      finally { opening = false; render(); onRefresh?.() }
    })
    return {update(next) { if (state.selectedProfile !== next.selectedProfile) message = ''; state = {...state,...next}; render() }, close}
  }
  window.ProfilePicker = {rowsFor,searchRows,openAllowed,mount}
})()