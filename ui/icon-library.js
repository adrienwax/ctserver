// Owner-facing SVG library. Profile selection and artwork editing are separate explicit actions.
'use strict'
window.IconLibrary = (() => {
  const { iconSvg, importSvg } = window.ICON_TOOLS
  let icons = {}, folder = '', selected = 'home', draft = null, choose = null, refreshId = 0, scratch = false
  let session = 0, draftRevision = 0, writing = false
  const dialog = document.createElement('dialog')
  dialog.id = 'icondlg'
  dialog.innerHTML = `<div class="dh-plain"><span>Icon library</span><button class="x" data-icon-close aria-label="Close icon library">×</button></div>
    <p class="icon-help">Choose artwork for the selected key. Labels and actions stay with the key. Editing an icon updates every key using that icon.</p>
    <div class="icon-library-layout"><div class="icon-grid" aria-label="Available icons"></div><div class="icon-editor">
    <div class="icon-large" aria-hidden="true"></div><strong class="icon-name"></strong><span class="icon-origin"></span>
    <button class="act primary" data-icon-use>Use on selected key</button>
    <button class="act" data-icon-import>Import SVG</button><input type="file" accept=".svg,image/svg+xml" aria-label="SVG artwork file" hidden>
    <button class="act" data-icon-download>Download SVG</button><button class="act primary" data-icon-save disabled>Save edited icon</button>
    <button class="act" data-icon-reset>Restore default</button><p class="icon-edit-help">Edit the downloaded SVG in a vector editor, then import it here. Preview first; Save keeps a backup. Use plain SVG shapes or single paths; separate compound paths. Simple fill/stroke styles work; images, effects and transparency do not.</p>
    </div></div><div class="icon-message" role="status"></div><div class="acts"><span class="icon-folder"></span><button class="act sm" data-icon-folder>Open editable folder</button><button class="act sm" data-icon-refresh>Refresh from disk</button></div>`
  document.body.appendChild(dialog)
  const q = s => dialog.querySelector(s)
  const message = text => { q('.icon-message').textContent = text }
  const request = async (url, body) => {
    const result = await fetch(url, body ? { method: 'POST', headers: { 'X-CT-Router': '1' }, body: JSON.stringify(body) } : {}).then(r => r.json())
    if (result.error) throw new Error(result.error)
    return result
  }
  const svg = name => icons[name]?.lines ? iconSvg(icons[name].lines, { decorative: true }) : ''
  function adopt(result) {
    icons = result.icons; folder = result.folder; scratch = result.scratch === true
    window.dispatchEvent(new Event('ct-icons-changed'))
  }
  async function refresh() {
    const ticket = ++refreshId
    const result = await request('/api/icons')
    if (ticket !== refreshId) return
    adopt(result)
    if (dialog.open && !draft) render()
  }
  function render() {
    q('.icon-grid').innerHTML = ''
    for (const name of ['', ...window.SCHEMA.ICONS]) {
      const button = document.createElement('button')
      button.className = 'icon-choice' + (name === selected ? ' on' : '')
      button.type = 'button'; button.dataset.iconName = name
      button.setAttribute('aria-pressed', String(name === selected))
      button.innerHTML = name ? svg(name) : '<span class="icon-none">Aa</span>'
      const label = document.createElement('span'); label.textContent = name || 'Label only'; button.appendChild(label)
      q('.icon-grid').appendChild(button)
    }
    const data = selected && icons[selected]
    q('.icon-large').innerHTML = draft ? iconSvg(draft, { decorative: true }) : svg(selected)
    q('.icon-name').textContent = selected || 'Label only'
    q('.icon-origin').textContent = draft ? 'Imported preview · not saved' : data?.error ? 'Invalid owner file · default shown' : data?.source === 'custom' ? 'Owner SVG' : 'Bundled default'
    q('[data-icon-use]').disabled = !choose
    for (const selector of ['[data-icon-download]', '[data-icon-import]']) q(selector).disabled = !selected
    q('[data-icon-reset]').disabled = !selected || writing
    q('[data-icon-save]').disabled = !draft || writing
    q('.icon-folder').textContent = folder
    q('.icon-folder').title = folder
    if (data?.error) message(data.error)
  }
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return
    const ownerSession = session
    try {
      if (button.hasAttribute('data-icon-close')) dialog.close()
      if (button.hasAttribute('data-icon-import')) q('input[type=file]').click()
      if (button.hasAttribute('data-icon-name')) {
        if (draft) return message('Save the imported preview, or close and reopen to discard it, before choosing another icon.')
        selected = button.dataset.iconName; draftRevision++; message(''); render()
      }
      if (button.hasAttribute('data-icon-use')) {
        if (draft) return message('Save the edited icon before assigning it.')
        if (choose?.(selected) !== false) dialog.close()
      }
      if (button.hasAttribute('data-icon-download')) {
        const blob = new Blob([iconSvg(draft || icons[selected].lines)], { type: 'image/svg+xml' }), url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = selected + '.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      if (button.hasAttribute('data-icon-save') || button.hasAttribute('data-icon-reset')) {
        if (writing) return message('An icon save is still finishing. Your new preview is kept.')
        if (/[?&]mock\b/.test(location.search) && !scratch) return message('Preview mode: artwork is not written. Open the regular panel to save owner icons.')
        const reset = button.hasAttribute('data-icon-reset'), name = selected, revision = draftRevision
        writing = true; refreshId++; render()
        try {
          const result = await request('/api/icon', { name, lines: draft, reset })
          refreshId++; adopt(result)
          if (dialog.open && session === ownerSession && selected === name && draftRevision === revision) {
            draft = null
            message(`${reset ? 'Default restored' : 'Icon saved'}. ${result.backup ? 'Previous file backed up. ' : ''}The connected deck refreshes from the same SVG.`)
          }
        } finally { writing = false; if (dialog.open) render() }
      }
      if (button.hasAttribute('data-icon-refresh')) {
        if (draft) return message('Save the imported preview, or close and reopen to discard it, before refreshing.')
        await refresh()
        if (!/[?&]mock\b/.test(location.search)) await request('/api/deck', { type: 'reload' }).catch(() => {})
        if (dialog.open && session === ownerSession) message('Icons refreshed from disk.')
      }
      if (button.hasAttribute('data-icon-folder')) {
        if (/[?&]mock\b/.test(location.search) && !scratch) return message('Preview mode: no owner folder is created or opened.')
        await request('/api/open-icons', {}); await refresh()
        if (dialog.open && session === ownerSession) message('Editable SVG folder opened. Missing defaults copied; existing icons preserved.')
      }
    } catch (error) { if (dialog.open && session === ownerSession) { message(error.message); render() } }
  })
  dialog.addEventListener('close', () => { session++; draftRevision++ })
  q('input[type=file]').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !selected) return
    const ownerSession = session, name = selected, revision = ++draftRevision
    const current = () => dialog.open && session === ownerSession && selected === name && draftRevision === revision
    try {
      const text = await file.text()
      if (!current()) return
      draft = importSvg(text); message('Preview loaded. Save edited icon applies it to every key using this name.'); render()
    } catch (error) { if (current()) message(error.message) }
  })
  return {
    svg, lines: name => icons[name]?.lines || [], refresh,
    ready: refresh().catch(() => {}),
    open(name, onChoose) {
      const ownerSession = ++session; draftRevision++
      selected = window.SCHEMA.ICONS.includes(name) ? name : ''; draft = null; choose = onChoose; message(''); render(); dialog.showModal()
      refresh().catch(error => { if (dialog.open && session === ownerSession) message(error.message) })
    },
  }
})()
