// waxyct. Two views over one snapshot of the router's state (S): BUTTONS (the editor: the profile bar
// on top, the CT drawn in the centre with what every control does, the inspector and the actions
// library on the right) and STATUS (the CT's health, who holds it, the fixes, the logs).
// Data from /events, or from mock.js when opened with ?mock (every state, no router, no CT).
'use strict'
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const MOCK = /[?&]mock\b/.test(location.search)
const OWNER = {
  waxyct: { label: 'waxyct', badge: 'b-waxyct', name: 'the waxyct deck' },
  'td-bridge': { label: 'TD bridge', badge: 'b-td', name: 'the TD bridge' },
  edena: { label: 'EDENA', badge: 'b-edena', name: 'EDENA' },
  probe: { label: 'Input test', badge: 'b-probe', name: 'the input test' },
  unknown: { label: 'Unknown', badge: 'b-unknown', name: 'an unknown process' },
}
const who = (o) => OWNER[o] || { label: o, badge: 'b-unknown', name: o }
// host/schema.mjs, loaded by index.html before this file: the one list of controls, colours, actions, TD verbs, limits
const { COLORS: COLOR, ACTIONS: KINDS, KEY_SLOTS, TD_VERBS, LIMITS, ICONS, pageOf } = window.SCHEMA
// The status page's verdict colours as suite tokens: valid, advisory, caution, neutral. The deck still draws its own.
const VERDICT = { sage: 'var(--fn-valid)', sand: 'var(--fn-warn)', rose: 'var(--fn-caution)', dust: 'var(--txt-3)', bone: 'var(--txt-1)' }

let S = null            // the last snapshot
let skew = 0            // Date.now() - S.now, so relative times tick between snapshots
let online = false
let fixStart = 0        // guided replug started at (router time)
let lastKey = ''        // headline identity, to animate only real changes
let dismissed = ''      // an error the viewer closed
let pageBuild = null    // the router build this page was loaded from (see WAXY.status)
let view = 'controls'
const { bindingTarget, sameBindingTarget, applyActionAppearance, controlledAppStatus } = window.EditorModel
let contextRevision = 0
function captureTarget(k = sel?.k, trig = sel?.trig) { return bindingTarget(edit, k, trig, contextRevision) }
function validTarget(target) { return sameBindingTarget(target, edit, sel?.k, sel?.trig, contextRevision) }
function cancelBindingContext() {
  contextRevision++
  pending = null; armed = null; dragItem = null; sel = null; renaming = null; learn = false
  $('#learnbtn').classList.remove('on')
  $('#pop').hidden = true
  $('#pop-replace').onclick = null; $('#pop-hold').onclick = null
  $('#ct').classList.remove('arming', 'dragging')
  $$('#ct .drop, #ct .over').forEach(el => el.classList.remove('drop', 'over'))
}
const now = () => Date.now() - skew

function ago(t) {
  if (!t) return '-'
  const s = Math.max(0, Math.round((now() - t) / 1000))
  return s < 2 ? 'just now' : s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}
const clock = (t) => t ? new Date(t).toTimeString().slice(0, 5) : '-'

// =====================================================================================================
// STATUS: what the CT is doing
// =====================================================================================================
function derive(s) {
  const c = s.claim, alerts = []
  const replugBtn = fixStart ? null : { label: 'Start guided replug', run: 'replug' }
  if (!online) return { cls: 'st-bad', pill: 'bad', state: 'waxyct offline', owner: null, alerts: [{ kind: 'bad', side: 'router', head: 'The router is not running', text: 'Double-click waxyct on the Desktop. This window reconnects by itself.' }] }
  let h
  if (s.busy) h = { cls: 'st-busy', pill: 'busy', state: s.target === 'test' ? 'Starting test' : 'Handing over', owner: c && c.owner }
  else if (!s.usb.present) {
    h = { cls: 'st-off', pill: 'bad', state: 'Unplugged', owner: c && c.owner }
    if (!fixStart) alerts.push({ kind: 'info', side: 'CT', head: 'No CT on USB', text: c ? `${who(c.owner).name} keeps its claim and takes the CT back when it is plugged in.` : 'Plug it straight into the PC, not into a hub.' })
  } else if (c) {
    const o = who(c.owner)
    const idle = c.lastInput ? Math.round((now() - c.lastInput) / 1000) : null
    switch (c.state) {
      case 'connected': h = { cls: 'st-ok', pill: 'ok', state: c.owner === 'probe' ? 'Testing input' : 'Connected', owner: c.owner }; break
      case 'quiet':
        h = { cls: 'st-warn', pill: 'ok', state: 'No input', owner: c.owner }
        alerts.push({ kind: 'warn', quiet: true, side: o.label, head: `Nothing from the CT for ${idle} s`, text: 'Normal if nobody is touching it. If you have been turning dials and nothing happens, it has gone quiet: replug it.', acts: [replugBtn] })
        break
      case 'heartbeat-lost':
        h = { cls: 'st-bad', pill: 'bad', state: 'Heartbeat lost', owner: c.owner }
        alerts.push({ kind: 'bad', side: o.label, head: 'The CT stopped answering', text: `${o.name} is reconnecting on its own. If it is not back in about 10 s, replug the CT.`, acts: [replugBtn] })
        break
      case 'connecting': h = { cls: 'st-busy', pill: 'busy', state: 'Connecting', owner: c.owner }; break
      case 'closing': h = { cls: 'st-busy', pill: 'busy', state: 'Closing', owner: c.owner }; break
      case 'not-found': h = { cls: 'st-off', pill: 'bad', state: 'Not found', owner: c.owner }; break
      default:
        h = { cls: 'st-busy', pill: 'busy', state: 'Reconnecting', owner: c.owner }   // in flight: amber; crimson only once it is lost
        alerts.push({ kind: 'warn', side: o.label, head: 'Lost the CT', text: `${o.name} lost the port and retries every few seconds. It keeps its claim, so nothing else takes the CT meanwhile.` })
    }
    if (c.owner === 'td-bridge' && s.td.ok === false) alerts.push({ kind: 'warn', side: 'TouchDesigner', head: `TD is not answering on ${S.tdPort || 'its port'}`, text: 'The bridge holds the CT but has nowhere to send it: dials do nothing. Open the rig with mcp_webserver_base_td2021.tox running.' })
  } else {
    const stray = s.procs.bridges.filter((b) => !b.ours)
    const old = s.procs.edenaMain && s.procs.edenaMain.hooks === false
    if (s.procs.loupedeck.length) {
      h = { cls: 'st-warn', pill: 'warn', state: 'Held elsewhere', owner: 'unknown' }
      alerts.push({ kind: 'warn', side: 'Loupedeck app', head: `${s.procs.loupedeck.join(', ')} is running`, text: 'It holds the CT without a claim. Quit it to use the CT here.' })
    } else if (stray.length) {
      h = { cls: 'st-warn', pill: 'warn', state: 'Held elsewhere', owner: 'unknown' }
      alerts.push({ kind: 'warn', side: 'TD bridge', head: `A bridge outside waxyct (pid ${stray.map((b) => b.pid).join(', ')})`, text: 'It has no claim, so it is an old copy. Stop it with Ctrl-C in its own terminal.' })
    } else if (old) {
      h = { cls: 'st-warn', pill: 'warn', state: 'Held elsewhere', owner: 'unknown' }
      alerts.push({ kind: 'warn', side: 'EDENA', head: 'An EDENA without the router hooks is open', text: `${s.procs.edenaMain.exe || 'EDENA'} can hold the CT without a claim, and ignores waxyct. Quit it; waxyct starts the hooked build.` })
    } else h = { cls: 'st-free', pill: '', state: 'Free', owner: null }
  }
  if (s.error && s.error.id !== dismissed) {
    const e = s.error
    alerts.unshift({ kind: 'bad', side: e.side, head: e.what, text: e.fix, acts: [e.force && { label: `Force stop ${e.forceName || e.force}`, run: 'force', danger: true }, { label: 'Dismiss', run: 'dismiss' }].filter(Boolean) })
  }
  return { ...h, alerts }
}

function render() {
  if (!S) return
  const d = derive(S), c = S.claim
  // the top bar: the pill is the CT's state wherever you are
  $('#pill').className = `pill ${d.pill}`
  $('#pill-state').textContent = d.state
  $('#pill-sub').textContent = !online ? '' : S.busy ? S.busy : c && c.owner !== 'waxyct' ? who(c.owner).label : 'CT'
  chip('#chip-port', !S.usb.present ? 'bad' : c && c.state === 'connected' ? 'teal' : '', S.usb.present ? S.usb.port : 'no CT')
  const appStatus = controlledAppStatus(S, online, now())
  chip('#chip-td', appStatus.kind, appStatus.text)
  $('#chip-td').hidden = !appStatus.text
  $('#chip-td').title = appStatus.detail
  const v = S.build?.label || 'KRAB v1.0'
  if ($('#ver').textContent !== v) $('#ver').textContent = v
  const buildDetail = S.build ? `${S.build.version} · ${S.build.commit}` : 'Build details unavailable'
  $('#ver').title = `${v}\nInternal build: ${buildDetail}`
  $('#hud-ver').textContent = `Internal build: ${buildDetail}`
  const key = d.cls + d.state
  if (key !== lastKey) {
    $('#state').textContent = d.state
    $('#state').classList.remove('enter'); void $('#state').offsetWidth; $('#state').classList.add('enter')
    lastKey = key
  }
  document.title = `CTserver · ${v} · ${d.state}`

  renderStatus(d)
  renderBanner(d)
  syncEditor()
  renderProfileBar()
  renderSurface()
  renderTest()

  $('#app').classList.toggle('offline', !online)
  $('#hud-live').classList.toggle('off', !online)
  $('#hud-live').lastElementChild.textContent = online ? 'live' : 'offline'
  $('#hud-msg').textContent = S.note || ''
}
function chip(sel, kind, text) { const el = $(sel); el.className = `chip ${kind}`; el.lastElementChild.textContent = text }

// The Buttons view shows the one thing that needs attention, with a way to the detail.
function renderBanner(d) {
  const a = d.alerts.find((x) => x.kind === 'bad') || d.alerts.find((x) => x.kind === 'warn' && !x.quiet)
  const b = $('#banner')
  const live = S.claim && S.claim.owner === 'waxyct'
  const onEdena = (profileList().find((x) => x.id === edit.profile) || {}).handoff
  const html = a ? `<div class="head"><span>${esc(a.head)}</span></div><p>${esc(a.text || '')}</p><button class="act sm" data-go="status">Status</button>`
    : online && !live && !S.busy && !S.test && !onEdena && !(view==='controls'&&edit.profile==='main'&&!S.host) ? `<div class="head"><span>waxyct is not holding the CT</span></div><p>${S.claim ? `${esc(who(S.claim.owner).name)} has it.` : 'Nobody has it.'} You can still edit the buttons; they apply when waxyct takes it back.</p><button class="act sm" data-take="1">Take the CT</button>` : ''
  b.hidden = !html
  b.className = `alert compact ${a ? a.kind : 'info'}`
  if (b.innerHTML !== html) b.innerHTML = html
}

let lastInputSeen = 0
function setFact(sel, html, pulseOn) {
  const el = $(sel)
  if (el.innerHTML !== html) el.innerHTML = html
  if (pulseOn && pulseOn !== lastInputSeen && sel === '#f-input') { lastInputSeen = pulseOn; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse') }
}

function renderStatus(d) {
  const c = S.claim
  $('#hero').className = `hero ${d.cls}`
  const o = d.owner && who(d.owner)
  const tail = !online ? '' : S.busy ? esc(S.busy) : !c ? (S.procs.edena.length && d.cls === 'st-free' ? 'Nobody holds it. EDENA is open, without the CT.' : d.owner ? '' : 'Nobody holds it.')
    : c.owner === 'probe' ? 'sends nothing to TD' : c.owner === 'waxyct' && S.host ? `${esc(S.host.profileName)} · ${esc(S.host.pageName)}` : `pid ${c.pid}`
  const ol = (o ? `<span class="badge ${o.badge}">${esc(o.label)}</span>` : '') + `<span>${tail}</span>`
  if ($('#owner-line').innerHTML !== ol) $('#owner-line').innerHTML = ol
  $('#status-aside').textContent = S.usb.present ? S.usb.port : 'no CT on USB'
  setFact('#f-port', S.usb.present ? `${esc(S.usb.port)} <small>USB serial</small>` : '<small>unplugged</small>')
  setFact('#f-since', c ? `${clock(c.since)} <small>${ago(c.since)}</small>` : '-')
  setFact('#f-input', c && c.lastInput ? `${ago(c.lastInput)} <small>${esc(c.lastEvent || '')}</small>` : '-', c && c.lastInput)
  const al = d.alerts.map((a, i) => `<div class="alert ${a.kind}"><div class="head"><span>${esc(a.head)}</span><span class="side">${esc(a.side)}</span></div>` +
    (a.text ? `<p>${esc(a.text)}</p>` : '') +
    (a.acts && a.acts.some(Boolean) ? `<div class="acts">${a.acts.filter(Boolean).map((b, j) => `<button class="act sm${b.danger ? ' danger' : ''}" data-run="${b.run}" data-i="${i}.${j}">${esc(b.label)}</button>`).join('')}</div>` : '') + '</div>').join('')
  if ($('#alerts').innerHTML !== al) $('#alerts').innerHTML = al
  renderTiles(d)
  renderSteps()
  renderChecks()
  renderReplug()
}

function renderTiles(d) {
  const c = S.claim, busy = !!S.busy || !online
  const edenaOpen = S.procs.edena.length > 0
  const holds = (k) => (k === 'waxyct' && c && c.owner === 'waxyct') || (k === 'td' && c && c.owner === 'td-bridge') || (k === 'edena' && c && c.owner === 'edena') || (k === 'none' && !c && S.usb.present && d.cls === 'st-free')
  const sub = {
    waxyct: c && c.owner === 'waxyct' ? (S.host ? `holds the CT: ${S.host.profileName}` : 'holds the CT') : 'the CT manager: Windows, TD, apps',
    td: S.test && S.test.prev === 'td' ? 'gets the CT back after the test'
      : c && c.owner === 'td-bridge' ? (S.td.ok ? 'holds the CT, TD answering' : 'holds the CT, TD not answering')
      : !S.hooks.bridge ? 'no router hooks' : 'the old TD-only bridge',
    edena: S.test && S.test.prev === 'edena' ? 'gets the CT back after the test'
      : c && c.owner === 'edena' ? 'holds the CT'
      : edenaOpen ? (S.procs.edenaMain && S.procs.edenaMain.hooks === false ? 'open, old build: no hooks' : 'open, CT away')
      : !S.hooks.edena ? 'no hooked build found' : S.edena && S.edena.kind === 'build' ? 'starts from its build' : 'starts from its source',
    none: c ? 'release the CT, leave it free' : 'the CT sits free',
  }
  const dot = {
    waxyct: c && c.owner === 'waxyct' ? (c.state === 'connected' || c.state === 'quiet' ? 'ok' : 'warn') : '',
    td: c && c.owner === 'td-bridge' ? (c.state === 'connected' && S.td.ok ? 'ok' : 'warn') : !S.hooks.bridge ? 'bad' : '',
    edena: c && c.owner === 'edena' ? (c.state === 'connected' ? 'ok' : 'warn') : !S.hooks.edena || (S.procs.edenaMain && S.procs.edenaMain.hooks === false) ? 'bad' : edenaOpen ? 'ok' : '',
    none: '',
  }
  $$('.tile').forEach((t) => {
    const k = t.dataset.to, on = holds(k)
    t.classList.toggle('on', on)
    t.classList.toggle('target', !!S.busy && S.target === k)
    t.setAttribute('aria-pressed', on)
    t.disabled = busy
    t.querySelector('.t-sub').textContent = sub[k]
    t.querySelector('.t-dot').className = `t-dot ${dot[k]}`
  })
}

function renderSteps() {
  const show = S.busy || S.error || (S.stepsAt && now() - S.stepsAt < 30000)
  const html = (show ? S.steps || [] : []).map((st) => `<li class="${st.state}">${esc(st.label)}</li>`).join('')
  if ($('#steps').innerHTML !== html) $('#steps').innerHTML = html
}

let healthAll = false     // Health shows every check, not only those that need attention
const STATE_WORD = { connected: 'connected', quiet: 'no input lately', 'heartbeat-lost': 'heartbeat lost, reconnecting', disconnected: 'lost the port, reconnecting', 'not-found': 'CT not found on USB', connecting: 'connecting', closing: 'closing the port' }
function renderChecks() {
  const c = S.claim, p = S.power || {}
  const rows = [
    ['USB', S.usb.present ? 'ok' : 'bad', S.usb.present ? `${esc(S.usb.port)}, USB Serial Device` : 'not plugged in'],
    ['Link', !c ? '' : c.state === 'connected' ? 'ok' : ['quiet', 'closing', 'connecting', 'disconnected'].includes(c.state) ? 'warn' : 'bad',   // reconnecting is in flight: amber
      c ? `${esc(STATE_WORD[c.state] || c.state)}${c.heartbeatLost ? `<small>heartbeat lost ${c.heartbeatLost} times this session</small>` : ''}` : 'no owner'],
    ['TouchDesigner', S.td.ok === null ? '' : S.td.ok ? 'ok' : 'warn', S.td.ok ? `answering <small>${esc(S.td.detail)}</small>` : `${esc(S.td.detail || 'checking')}`],
    ['Selective suspend', !p.suspend ? '' : p.suspend.ac || p.suspend.dc ? 'bad' : 'ok', !p.suspend ? 'unknown' : p.suspend.ac || p.suspend.dc ? 'ON: the likely cause of the quiet state<small>Power Options, USB settings, USB selective suspend: Disabled</small>' : 'off'],
    ['Hub power saving', !p.hub ? '' : p.hub.allowOff ? 'warn' : 'ok', !p.hub ? 'unknown' : p.hub.allowOff ? `ON for ${esc(p.hub.name)}<small>Device Manager, ${esc(p.hub.name)}, Power Management: untick "Allow the computer to turn off this device"</small>` : `off for ${esc(p.hub.name)}`],
    ['Keys sent', !S.host ? '' : S.host.counts && S.host.counts.blocked ? 'warn' : 'ok', !S.host ? 'the waxyct deck is not running' : S.host.counts && S.host.counts.blocked ? `${S.host.counts.blocked} blocked by Windows<small>an administrator window in front ignores keys from a normal program</small>` : `${(S.host.counts && S.host.counts.actions) || 0} actions, none blocked`],
    ['Loupedeck app', S.procs.loupedeck.length ? 'bad' : 'ok', S.procs.loupedeck.length ? `running: ${esc(S.procs.loupedeck.join(', '))}` : 'not running'],
    ['Router hooks', S.hooks.bridge && S.hooks.edena ? 'ok' : 'bad', `bridge ${S.hooks.bridge ? 'yes' : 'missing'}, EDENA ${S.hooks.edena ? 'yes' : 'missing'}`],
    ['With Windows', S.autostart ? 'ok' : '', `${S.autostart ? 'starts when you log in' : 'starts when you double-click it'} <button class="act sm" data-autostart="${S.autostart ? '' : '1'}">${S.autostart ? 'Turn off' : 'Start with Windows'}</button>`],
    ...Object.entries((S.host && S.host.moshpit) || {}).map(([id, m]) => [`Moshpit link${id === 'moshpit' ? '' : ` (${id})`}`, m.phase === 'connected' ? 'ok' : m.phase === 'error' ? 'bad' : 'warn',
      m.phase === 'connected' ? `connected${m.project ? ` to ${esc(m.project)}` : ''}<small>slots: ${esc(m.slots.join(', ') || 'none')}</small>` : `${esc(m.phase)}<small>${esc(m.detail || '')}</small>`]),
    ...(S.configUpdates?.preserved?.length ? [['Saved mappings', 'warn', `Your ${S.configUpdates.preserved.length} customised or older configuration files were kept.<small>New defaults: File → Open folder → .updates/incoming. Compare before adopting; .updates/report.json lists each file.</small>`]] : []),
    ['EDENA starts', S.edena ? (S.edena.hooks ? 'ok' : 'bad') : '', S.edena ? `from its ${esc(S.edena.kind)}<small>${esc(S.edena.cmd)}</small>` : '-'],
  ]
  const bad = rows.filter((r) => r[1] === 'bad').length, warn = rows.filter((r) => r[1] === 'warn').length
  $('#health-aside').textContent = bad ? `${bad} to fix` : warn ? `${warn} to check` : 'all clear'
  // what needs attention, and the one setting (With Windows); the rest behind "Show all"
  const shown = healthAll ? rows : rows.filter(([k, st]) => st === 'bad' || st === 'warn' || k === 'With Windows')
  const hidden = rows.length - shown.length
  const html = shown.map(([k, st, v]) => `<li><span class="d ${st}"></span><span class="k">${k}</span><span class="v">${v}</span></li>`).join('') +
    (hidden ? `<li class="more"><span class="d ok"></span><span class="k">${hidden} more ok</span><span class="v"><button class="act sm" data-health-all="1">Show all</button></span></li>`
      : healthAll ? '<li class="more"><span class="d"></span><span class="k"></span><span class="v"><button class="act sm" data-health-all="">Only what needs attention</button></span></li>' : '')
  if ($('#checks').innerHTML !== html) $('#checks').innerHTML = html
}

// ---- guided replug (in the Status view's CT panel)
function replugSteps() {
  const t = now(), { goneAt, backAt } = S.replug, c = S.claim
  const out = goneAt > fixStart, back = out && backAt > goneAt
  const gap = back ? backAt - goneAt : t - goneAt
  const long = out && gap >= 5000, replugged = back && long
  const reconnected = replugged && c && c.state === 'connected' && c.updated > backAt
  const input = reconnected && c.lastInput > backAt
  return [
    [out ? 'done' : 'now', 'Unplug the CT, the cable at the PC end.'],
    !out ? ['todo', 'Leave it out for 5 s.'] : back && !long ? ['fail', `Back after ${(gap / 1000).toFixed(1)} s, too quick. Unplug it again.`] : [long ? 'done' : 'now', long ? 'Out for 5 s.' : 'Leave it out for 5 s.'],
    [replugged ? 'done' : long ? 'now' : 'todo', 'Plug it straight into the PC, not into a hub.'],
    [reconnected ? 'done' : replugged ? 'now' : 'todo', !c && replugged ? 'Nobody holds the CT: pick an owner below.' : `The owner reconnects on its own${c ? ` (${who(c.owner).label})` : ''}.`],
    [input ? 'done' : reconnected ? 'now' : 'todo', input ? 'Input arrives. Fixed.' : 'Turn any dial.'],
    { countdown: out && !back && !long ? Math.max(0, Math.ceil((5000 - gap) / 1000)) : null },
  ]
}
function renderReplug() {
  $('#fixbtn').textContent = fixStart ? 'Guided replug running' : 'Start guided replug'
  $('#fixbtn').disabled = !!fixStart || !online
  $('#guide').hidden = !fixStart
  if (!fixStart) return
  const list = replugSteps(), meta = list.pop()
  $('#fixstop').textContent = list.every(([st]) => st === 'done') ? 'Close' : 'Stop'
  $('#fixcount').textContent = meta.countdown !== null ? `${meta.countdown} s` : ''
  const html = list.map(([st, text], i) => `<li class="${st}"><span class="n">${st === 'done' ? '✓' : st === 'fail' ? '!' : i + 1}</span><span>${esc(text)}</span></li>`).join('')
  if ($('#fixsteps').innerHTML !== html) $('#fixsteps').innerHTML = html
}

// =====================================================================================================
// BUTTONS: the editor
// =====================================================================================================
// The CT's controls, as the page draws them. data-k is the control; kind says where it lives in a profile.
const KEY_IDS = KEY_SLOTS.map((i) => `center:${i}`)
const SQ_L = ['home', 'undo', 'keyboard', 'enter', 'save', 'fnL'], SQ_R = ['a', 'c', 'fnR', 'b', 'd', 'e']
const ROTARY_MODIFIERS = { keyboard: { name: 'Keyboard · Fine', label: 'Fine', key: 'KBD' }, fnL: { name: 'Fn · Fast', label: 'Fast', key: 'Fn' }, fnR: { name: 'Fn · Fast', label: 'Fast', key: 'Fn' } }
$('#keys').innerHTML = KEY_IDS.map((k) => `<button class="c key" data-k="${k}"></button>`).join('') + '<div class="ct-note" id="ct-note" hidden></div>'
$('#round').innerHTML = Array.from({ length: LIMITS.pages + 1 }, (_, i) => `<button class="c" data-k="b${i}"></button>`).join('')
$('#sqL').innerHTML = SQ_L.map((k) => `<button class="c" data-k="${k}"></button>`).join('')
$('#sqR').innerHTML = SQ_R.map((k) => `<button class="c" data-k="${k}"></button>`).join('')

const TRIG = { do: 'Tap', hold: 'Hold', redo: 'Fn + tap', turn: 'Turn', press: 'Press', tap: 'Tap' }
function slotOf(k) {
  if (ROTARY_MODIFIERS[k]) return { k, kind: 'button', slot: k, name: ROTARY_MODIFIERS[k].name, trigs: [], reserved: true }
  if (/^center:\d+$/.test(k)) return { k, kind: 'key', slot: k.split(':')[1], name: `Key ${Number(k.split(':')[1]) + 1}`, trigs: ['do'] }
  if (k === 'knobCT') return { k, kind: 'wheel', slot: null, name: 'The wheel', trigs: ['turn', 'tap'] }
  if (/^knob(TL|CL|BL|TR|CR|BR)$/.test(k)) return { k, kind: 'dial', slot: k.slice(4), name: `Dial ${k.slice(4)}`, trigs: ['turn', 'press'] }
  if (SQ_L.includes(k) || SQ_R.includes(k)) return { k, kind: 'button', slot: k, name: `Button ${k === 'keyboard' ? 'kbd' : k}`, trigs: k === 'undo' ? ['do', 'hold', 'redo'] : ['do', 'hold'] }
  return null
}

// What an action does, in a few words: shown on the control and in the inspector.
const MEDIA_WORD = { playpause: 'play / pause', next: 'next track', prev: 'previous', previous: 'previous', stop: 'stop', mute: 'mute' }
// A key label that is one long word gets a smaller size instead of breaking mid-word.
const lb = (t) => `<span class="lb${String(t).split(' ').some((w) => w.length > 7) ? ' long' : ''}">${esc(t)}</span>`
function summarize(a) {
  if (!a) return ''
  const k = Object.keys(a).find((x) => KINDS.includes(x)), v = a[k]
  switch (k) {
    case 'keys': return Array.isArray(v) ? `${v[0] || '?'} / ${v[1] || '?'}` : v
    case 'native': return v.command || [v.verb, v.parameter || `parameter ${v.slot}`].join(' ')
    case 'media': return MEDIA_WORD[v] || v
    case 'volume': return `volume ${v > 0 ? '+' : ''}${v}`
    case 'scroll': return `scroll ${v}`
    case 'type': return `type "${v}"`
    case 'launch': return `open ${String(typeof v === 'string' ? v : v.path).split(/[\\/]/).pop()}`
    case 'focus': return `bring ${v} forward`
    case 'switch': { const p = profileList().find((x) => x.id === v); return `→ ${p ? p.name : v}` }
    case 'page': return `page ${v}`
    case 'moshpit': {   // where it lands in Moshpit: a command, an LFO, or slot n's param
      if (v.verb === 'command') return commandMeta[v.command]?.[0] || v.command.replace('.', ' ')
      if (v.verb === 'step') return v.commands[0].startsWith('transport.') ? 'Scrub frames' : v.commands[0].startsWith('block.') ? 'Select block' : v.commands[0].startsWith('folder.') ? 'Select folder' : v.commands[0].startsWith('source.zoom') ? 'Zoom clip' : v.commands[0].startsWith('mark.range') ? 'Transpose range' : v.commands[0].startsWith('clip.') ? 'Select clip' : `${commandMeta[v.commands[0]]?.[0] || v.commands[0]} / ${commandMeta[v.commands[1]]?.[0] || v.commands[1]}`
      if (v.verb === 'selstep') return v.step === -1 ? 'select previous node' : v.step === 1 ? 'select next node' : 'move the selected node'
      if (v.verb === 'bank') return v.width === 6 ? 'parameter page: P1-6 / P7-8 / LFO (missing parameters stay unavailable)' : 'bank: P1-3 / P4-6 / LFO'
      const where = v.path ? v.path : v.lfo ? `LFO ${v.lfo} ${v.field}` : v.bank ? `selected, bank ${v.bank}` : `slot ${v.slot} ${typeof v.param === 'number' ? `param ${v.param}` : v.param}`
      return `${v.verb === 'knob' ? '' : `${v.verb} `}${where}`
    }
    case 'app': { const a = ((S && S.host && S.host.apps) || []).find((x) => x.id === v); return `→ ${a ? a.name : v}` }
    case 'td': {   // the library's words when it has them ("next effect"), else the verb
      const s = JSON.stringify(a), it = window.ACTION_LIBRARY.flatMap((g) => g.items).find((x) => JSON.stringify(x.act) === s)
      if (it) return it.name.replace(/ \(turn\)$/, '').toLowerCase()
      const W = { rigKnob: `${v.par}`, rigReset: `reset ${v.par}`, rigToggle: `${v.par} on / off`, rigPulse: `pulse ${v.par}`, rigClip: `clip ${v.n}`,
        rigClipStep: v.step ? `clip ${v.step > 0 ? 'next' : 'previous'}` : 'step clips', rigFrameStep: 'scrub source frames', rigView: 'output window', recordToggle: 'REC' }
      return W[v.type] || `TD ${v.type}`
    }
    case 'macro': return `${v.length} steps`
    case 'main': return 'Home'
    case 'none': return ''
    default: return k || ''
  }
}
const isSet = (a) => !!a && !a.none

// ---- which profile and page the editor shows: the CT's, whenever waxyct holds it
const edit = { profile: null, page: 0 }
let renaming = null        // the page whose name is being typed
const profileRevisions = Object.create(null)
const cache = {}          // profile id -> its JSON, as on disk
let deckLive = false
let lastLiveContext = null
let navAt = 0              // a tab clicked here: give the deck 1.5 s to follow before following it back
const isParked = item => item?.tier === 'parked' || item?.parked === true
function profileList() { return (S?.host?.profiles || S?.configuration?.profiles || []).filter(p => !isParked(p) && !isParked((S?.host?.apps||S?.configuration?.apps)?.find(a => a.id === p.appId))).sort((x, y) => (y.id === 'main') - (x.id === 'main')) }   // MAIN first, as on the CT
function syncEditor() {
  deckLive = !!(S?.host?.connected && S.claim?.owner === 'waxyct' && S.children?.host === S.claim.pid)
  const h = S && S.host
  if (!h) { if(S?.configuration?.profiles?.some(p=>p.id==='main')){if(!edit.profile){edit.profile='main';edit.page=0}if(!cache[edit.profile])loadProfile(edit.profile)}return }
  const liveContext = `${h.profile}:${h.page}`
  if (lastLiveContext !== null && lastLiveContext !== liveContext && view === 'customize') { cancelBindingContext(); renderInspector(); renderLibrary() }
  lastLiveContext = liveContext
  if (/^pick-/.test(h.profile)) return void (edit.profile || (edit.profile = 'main'))
  const moved = edit.profile !== h.profile || edit.page !== h.page
  if (view === 'controls' && deckLive && moved && !editing() && Date.now() - navAt > 1500) {           // the CT moved (a round button, the switchboard): follow it
    cancelBindingContext(); edit.profile = h.profile; edit.page = h.page
    renderInspector(); renderLibrary()
  }
  if (!edit.profile) { edit.profile = h.profile; edit.page = h.page }
  if (!cache[edit.profile]) loadProfile(edit.profile)
}
const editing = () => document.activeElement && document.activeElement.closest && document.activeElement.closest('.fields')
async function loadProfile(id, force) {
  if (!id || (cache[id] && !force) || loadProfile.busy === id) return
  if (MOCK) { if (window.MOCK_PROFILES) { cache[id] = structuredClone(window.MOCK_PROFILES[id]); renderSurface(); renderInspector(); renderLibrary() } return }
  loadProfile.busy = id
  try {
    const r = await fetch('/api/profile', { method: 'POST', headers: { 'X-CT-Router': '1' }, body: JSON.stringify({ id }) }).then((x) => x.json())
    if (r.text && !saving && !r.problems?.length) {
      if (profileRevisions[id] !== undefined && profileRevisions[id] !== r.revision) discardProfileHistory(id)
      cache[id] = JSON.parse(r.text); profileRevisions[id] = r.revision
      renderSurface(); renderInspector(); renderLibrary()
    }   // a save started meanwhile is newer
  } catch {} finally { loadProfile.busy = null }
}
// Files edited outside (a text editor, the File dialog) come back in: the open profile is re-read now and then.
setInterval(() => { if (edit.profile && !editing() && !pending && !saving) loadProfile(edit.profile, true) }, 5000)
const curProfile = () => cache[edit.profile]
const curPage = () => { if(view==='controls'&&online&&edit.profile==='main'&&S?.host?.profile==='main'&&S.host.home&&deckLive)return S.host.home.page; const p = curProfile(), g = p && p.pages ? pageOf(p, edit.page) : null; return g && !g.status ? g : null }   // the status page is drawn by waxyct
const SECTION = { key: 'keys', dial: 'dials', button: 'buttons' }
// Is this control the profile's everyPage one (no control of the page's own in its place)? Edits to it reach every page.
function isShared(info, p = curProfile()) {
  const ep = p && p.everyPage, own = p && p.pages && p.pages[edit.page]
  if (!ep || !own || !info) return false
  if (info.kind === 'wheel') return !own.wheel && !!ep.wheel
  const sec = SECTION[info.kind]
  return !!(ep[sec] && ep[sec][info.slot]) && !(own[sec] && own[sec][info.slot])
}
// Where an edit to this control is written: everyPage for a shared control, else the page
function homeOf(info, prof) { return isShared(info, prof) ? prof.everyPage : prof.pages[edit.page] }
function tidyEveryPage(prof) { if (prof.everyPage && !Object.keys(prof.everyPage).length) delete prof.everyPage }
function controlOf(info, pg = curPage()) {
  if (!pg || !info) return null
  if (info.kind === 'wheel') return pg.wheel || null
  return (pg[SECTION[info.kind]] || {})[info.slot] || null
}

// ---- the profile bar
// Apps over profiles (config/apps.json): the App row, then the selected app's profiles, then its pages. MAIN is
// the first "app" (the switchboard). Legacy apps and profiles sit behind one "Legacy" disclosure, stepped back.
let showLegacy = false
let appPickerMarkup = null
const lastEdited = {}     // app -> the profile last opened here
function appList() {
  const apps = S?.host?.apps || S?.configuration?.apps || []
  return [{ id: 'main', name: 'Home', color: 'bone', tier: 'current' }, ...apps.filter(a => a.id !== 'main' && !isParked(a))]
}
const appOfProfile = (pid) => { const p = profileList().find((x) => x.id === pid); return (p && p.appId) || 'main' }
const profilesOf = (aid) => profileList().filter((p) => !p.pick && (aid === 'main' ? !p.appId : p.appId === aid))
function renderProfileBar() {
  const list = profileList()
  const errs = new Set((S && S.host ? S.host.errors : []).map((e) => e.file.replace(/^profiles\/|\.json$/g, '')))
  const curApp = appOfProfile(edit.profile)
  const apps = appList(), legacyApps = apps.filter((a) => a.tier === 'legacy')
  const legacyCount = legacyApps.length + list.filter(p => p.tier === 'legacy').length
  const current = apps.find(a => a.id === curApp)
  const option = a => `<option value="${esc(a.id)}"${a.id === curApp ? ' selected' : ''}>${esc(a.name)}${profilesOf(a.id).some(p => errs.has(p.id)) || errs.has('apps') ? ' · file error' : ''}</option>`
  const html = list.length ? `<span class="app-glyph" style="color:${COLOR[current?.color] || COLOR.bone}" aria-hidden="true">${window.IconLibrary.svg(curApp === 'main' ? 'home' : curApp === 'moshpit' ? 'mosh' : 'node')}</span><select id="app-select" aria-label="App">${apps.filter(a => a.tier !== 'legacy').map(option).join('')}${legacyApps.length && (showLegacy || current?.tier === 'legacy') ? '<optgroup label="Legacy">' + legacyApps.map(option).join('') + '</optgroup>' : ''}</select>${legacyCount ? `<button class="act sm" data-legacy="1" aria-pressed="${showLegacy}">${showLegacy ? 'Hide legacy' : 'Legacy (' + legacyCount + ')'}</button>` : ''}` : '<span class="none">Waiting for the waxyct deck…</span>'
  if (appPickerMarkup !== html) { $('#apptabs').innerHTML = html; appPickerMarkup = html }
  renderProfilePicker()
  const p = list.find((x) => x.id === edit.profile)
  const main = edit.profile === 'main'
  const pg = !p ? '' : p.handoff ? '<span class="none">EDENA (legacy) draws its own buttons on the CT. It is no longer on MAIN: hand it the CT from Status, or with the button below.</span>'
    : p.pages.map((n, i) => i === renaming ? `<input class="pgname" id="pgname" maxlength="${LIMITS.label}" value="${esc(n || '')}" aria-label="Page name">`
      : `<button role="tab" class="pgtab${i === edit.page ? ' on' : ''}" data-page="${i}" aria-selected="${i === edit.page}" title="Round button ${main ? i + 1 : i + 2} on the CT${main ? '' : '. Double-click to rename'}"><span class="rn">${main ? i + 1 : i + 2}</span>${esc(n || `Page ${i + 1}`)}</button>`).join('')
      + (main || view !== 'customize' ? '' : `<button class="pgtab tool" data-pgadd="1" title="Add a page (up to ${LIMITS.pages})"${p.pages.length >= LIMITS.pages ? ' disabled=""' : ''}>+</button><button class="pgtab tool" data-pgdel="1" title="Remove this page (Undo brings it back)"${p.pages.length < 2 ? ' disabled=""' : ''}>−</button>`)
  const typingName = document.activeElement && document.activeElement.id === 'pgname'
  if ($('#pgtabs').innerHTML !== pg && !typingName) { $('#pgtabs').innerHTML = pg; const f = $('#pgname'); if (f) { f.focus(); f.select() } }
  const gen = generatedFrom()
  $('#gen-note').hidden = !gen || view !== 'customize'
  if (gen) $('#gen-note').innerHTML = `Based on <code>${esc(gen)}</code>. Edits here are saved to your profile. Regeneration preserves edited profiles and writes a separate candidate for review; adopting a replacement keeps a backup.`
  $('#undobtn').disabled = !!saving || !undoStack.length
  $('#redobtn').disabled = !!saving || !redoStack.length
  $('#filebtn').disabled = !edit.profile
  $('#activatebtn').hidden = view !== 'customize' || (S?.host?.profile === edit.profile && S?.host?.page === edit.page)
  $('#device-selection').textContent = S?.host?.connected ? `CT · ${S.host.profileName || S.host.profile || 'Connected'} / ${S.host.pageName || ''}` : 'CT disconnected'
  $('#editing-target').textContent = `${view === 'customize' ? 'Mapping' : deckLive ? 'Live' : 'Configured'} · ${p?.name || 'Home'}${p?.pages?.[edit.page] ? ` / ${p.pages[edit.page]}` : ''}`
  $('#live-target').textContent = view === 'customize' && (S?.host?.profile !== edit.profile || S?.host?.page !== edit.page) ? `CT: ${S?.host?.profileName || 'Unavailable'} / ${S?.host?.pageName || ''}` : ''
}
function openProfile(id) {
  const p = profileList().find((x) => x.id === id)
  if (!p) return
  cancelBindingContext(); edit.profile = p.id; edit.page = 0; select(null)
  lastEdited[p.appId || 'main'] = p.id
  if (view === 'controls' && !p.handoff && deckLive) { navAt = Date.now(); api.post('/api/deck', { type: 'switch', id: p.id, profileOnly: true }) }
  loadProfile(p.id, true); render()
}
let projectRows = [], projectLoading = false, projectError = '', projectInventoryKey = ''
const profilePicker = window.ProfilePicker.mount($('#profile-picker'), {
  mock:MOCK, onSelect:openProfile, onRefresh:refreshProjects,
  icon:appId => window.IconLibrary.svg(!appId || appId === 'main' ? 'home' : appId === 'moshpit' ? 'mosh' : 'node'),
  onOpen:async identity => {
    if (MOCK) return {ok:false,error:'Browser demo cannot open native projects'}
    const response = await fetch('/api/project/open', {method:'POST', headers:{'Content-Type':'application/json','X-CT-Router':'1'}, body:JSON.stringify(identity)})
    const result = await response.json()
    return response.ok && result.ok ? result : {ok:false,error:result.error || `Project open refused (${response.status})`}
  },
})
function renderProfilePicker() {
  profilePicker.update({rows:window.ProfilePicker.rowsFor(profileList(),projectRows,appList(),showLegacy), selectedProfile:edit.profile, online, loading:projectLoading, error:projectError})
}
async function refreshProjects() {
  if (projectLoading || !online) return
  if (MOCK) { projectRows = Array.isArray(window.MOCK_PROJECTS) ? window.MOCK_PROJECTS : []; projectError = ''; renderProfilePicker(); return }
  projectLoading = true; projectError = ''; renderProfilePicker()
  try {
    const response = await fetch('/api/projects', {headers:{'X-CT-Router':'1'}, signal:AbortSignal.timeout(8000)})
    if (!response.ok) throw new Error('Project inventory unavailable')
    const result = await response.json()
    if (!Array.isArray(result.projects)) throw new Error('Project inventory unavailable')
    projectRows = result.projects
  } catch { projectError = 'Project links unavailable. Refresh to retry.' }
  finally { projectLoading = false; renderProfilePicker() }
}
// Metadata refresh never opens a project or rebuilds/focuses the search input.
setInterval(() => { if (online && view !== 'status') refreshProjects() },15000)
// An app: the profile last opened here, else the app's default, else its first current profile
$('#apptabs').onclick = (e) => {
  if (e.target.closest('[data-legacy]')) { showLegacy = !showLegacy; return renderProfileBar() }
}
$('#apptabs').onchange = (e) => {
  if (e.target.id !== 'app-select') return
  const aid = e.target.value, a = appList().find((x) => x.id === aid) || {}, mine = profilesOf(aid)
  const pick = [lastEdited[aid], a.default, (mine.find((p) => p.tier !== 'legacy') || mine[0] || {}).id].find((id) => id && mine.some((p) => p.id === id))
  if (pick) openProfile(pick)
}
$('#pgtabs').onclick = (e) => {
  if (e.target.closest('[data-pgadd]')) return editPages((ps) => { ps.push({ name: `PAGE ${ps.length + 1}`, editorId:crypto.randomUUID() }); return ps.length - 1 }, 'Page added')
  if (e.target.closest('[data-pgdel]')) return editPages((ps, prof) => { const gone = edit.page; ps.splice(gone, 1); renumberPages(prof, gone); return Math.max(0, gone - 1) }, `Page ${(curProfile().pages[edit.page] || {}).name || ''} removed`)
  const b = e.target.closest('[data-page]'); if (b) goPage(Number(b.dataset.page))
}
// Pages: add, remove, rename. Every change is a normal save, so Undo brings a removed page back.
$('#pgtabs').ondblclick = (e) => { const b = e.target.closest('[data-page]'); if (view === 'customize' && b && edit.profile !== 'main') { renaming = Number(b.dataset.page); renderProfileBar() } }
$('#pgtabs').addEventListener('keydown', (e) => { if (e.target.id !== 'pgname') return; if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { renaming = null; e.target.blur() } })
$('#pgtabs').addEventListener('focusout', (e) => {
  if (e.target.id !== 'pgname') return
  const i = renaming, name = e.target.value.trim().toUpperCase()
  renaming = null
  if (i === null || !name || name === curProfile().pages[i].name) return renderProfileBar()
  editPages((ps) => { ps[i].name = name; return i }, `Page renamed ${name}`)
})
function editPages(change, msg) {
  const prof = structuredClone(curProfile())
  if (!prof || !prof.pages) return
  const to = change(prof.pages, prof)
  save(prof, msg)
  goPage(to)
}
// A removed page: "page" actions past it move down one, and ones that pointed at it do nothing
function renumberPages(prof, gone) {
  const walk = (o) => {
    if (!o || typeof o !== 'object') return
    if (Number.isInteger(o.page)) { if (o.page === gone + 1) { delete o.page; o.none = true } else if (o.page > gone + 1) o.page-- }
    Object.values(o).forEach(walk)
  }
  walk(prof.pages); walk(prof.everyPage)
}
function goPage(i) {
  cancelBindingContext(); edit.page = i; select(null)
  if (view === 'controls' && deckLive && edit.profile === S.host.profile) { navAt = Date.now(); api.post('/api/deck', { type: 'page', page: i + 1 }) }
  render()
}

// ---- the surface: every control shows what it does
// Use the host's display text verbatim: the device and editor share one formatter. Feedback
// belongs to the live page and binding, never whichever profile the user is customizing.
function dialDisplay(info, control) {
  const h = S?.host, key = info.kind === 'wheel' ? 'wheel' : info.slot
  const feedback = h?.dialFeedback?.[key]
  const current = online && h?.connected && S?.claim?.owner === 'waxyct'
    && edit.profile === h.profile && edit.page === h.page
    && feedback?.bindingKey === JSON.stringify(control?.turn ?? null)
  const fallback = control?.name || (info.kind === 'wheel' ? 'Wheel' : summarize(control?.turn || control?.press))
  if (current && control?.turn?.moshpit?.bankWidth === 6 && feedback.label === '' && feedback.text === '' && !feedback.available) return { html: '', description: 'No parameter in this position' }
  const label = current && feedback?.label ? String(feedback.label) : fallback
  const available = !!(current && feedback?.available && typeof feedback.text === 'string' && feedback.text.trim())
  const text = available ? feedback.text : '—'
  const norm = available && typeof feedback.norm === 'number' && Number.isFinite(feedback.norm)
    ? Math.max(0, Math.min(1, feedback.norm)) : null
  const mapping = control?.name && control.name.toLowerCase() !== label.toLowerCase() ? control.name : ''
  if (typeof window !== 'undefined' && window.ControlFeedbackView) {
    const reading = current ? {...feedback,label} : {label,text:'—',available:false,norm:null}
    return window.ControlFeedbackView.gaugeView(reading,{kind:info.kind,mapping,label,profileName:curProfile()?.name || edit.profile,pageName:curPage()?.name || ''})
  }
  return {
    html: `${mapping ? `<span class="dial-map">${esc(mapping)}</span>` : ''}<span class="lb dial-label">${esc(label)}</span>`
      + `<span class="dial-value${available ? '' : ' unavailable'}">${esc(text)}</span>`
      + (norm === null ? '' : `<span class="dial-position" aria-hidden="true"><i style="width:${norm * 100}%"></i></span>`),
    description: `${label}: ${available ? text : 'value unavailable'}`,
  }
}
function renderSurface() {
  const p = curProfile(), pg = curPage(), list = profileList()
  const meta = list.find((x) => x.id === edit.profile)
  const pc = COLOR[(p && p.color) || (meta && meta.color)] || COLOR.bone
  const handoff = meta && meta.handoff
  const statusPage = !handoff && p && p.pages && p.pages[edit.page] && p.pages[edit.page].status
  const cells = statusPage ? statusCells() : null
  $('#ct').classList.toggle('handoff', !!handoff)
  $('#ct').classList.toggle('statuspage', !!statusPage)
  let homeNote=$('#home-detail');if(!homeNote){homeNote=document.createElement('div');homeNote.id='home-detail';homeNote.setAttribute('role','status');$('#ct').before(homeNote);}
  const disconnectedHome=view==='controls'&&edit.profile==='main'&&!deckLive;
  const home=view==='controls'&&edit.profile==='main'&&S?.host?.profile==='main'&&deckLive?S.host.home:disconnectedHome&&p?{mode:'configured',detail:'Configured Home / CT not connected. Inspect profiles and pages, or open Setup and Device. App and device controls need the connected CT.'}:null;
  homeNote.hidden=!home;homeNote.replaceChildren();if(home){const text=document.createElement('span');text.textContent=home.detail;homeNote.append(text);if(!disconnectedHome&&home.mode!=='home')for(const [label,kind,delta]of [['Previous','move',-1],['Select','select',0],['Next','move',1]]){const b=document.createElement('button');b.className='act sm';b.textContent=label;b.onclick=()=>api.post('/api/home',{kind,delta,revision:home.revision});homeNote.append(b);}}
  const note = $('#ct-note')
  note.hidden = !handoff
  if (handoff) {
    const holds = S.claim && S.claim.owner === 'edena'
    const html = `<b>EDENA draws the CT itself</b><span>While EDENA holds the CT it draws every control, round buttons included: 1-4 pick its pages. Nothing to map here.</span>` +
      (holds ? '<span class="ok">EDENA has the CT now.</span>' : `<button class="act sm primary" data-take="edena"${S.busy ? ' disabled' : ''}>Hand the CT to EDENA</button>`)
    if (note.innerHTML !== html) note.innerHTML = html
  }
  $('#ct').classList.toggle('idle', !pg && !S?.test)
  $('#ct').classList.toggle('empty', !!pg && !['keys', 'dials', 'buttons', 'wheel'].some((s) => pg[s] && Object.keys(pg[s]).length))
  for (const el of $$('#ct .c')) {
    const k = el.dataset.k
    let html = '', mapped = false, color = pc, title = ''
    const info = slotOf(k)
    if (info) {
      const c = controlOf(info, pg)
      if (info.reserved) {
        const modifier = ROTARY_MODIFIERS[k]
        mapped = true
        color = COLOR.bone
        html = `<span class="physical-id">${modifier.key}</span><span class="lb">${modifier.label}</span>`
        title = `${modifier.name}: hold while turning any knob or the wheel. Fixed on every profile.`
      } else if (info.kind === 'key' && cells) {             // the status page: shown, not mapped
        const s = cells[Number(info.slot)]
        mapped = !!s
        color = VERDICT[s ? s[2] : 'dust']
        html = s ? `${lb(s[0])}<span class="sm">${esc(s[1])}</span>` : ''
        title = s ? `Status page: ${s[0]} ${s[1]} (drawn by waxyct)` : 'Status page: blank'
      } else if (info.kind === 'key') {
        mapped = !!c && (isSet(c.do) || !!c.label || !!c.icon)
        color = COLOR[c && c.color] || pc
        const currentBank = c?.do?.moshpit?.verb === 'bank' && online && S?.host?.connected && S?.claim?.owner === 'waxyct'
          && edit.profile === S.host.profile && edit.page === S.host.page
        const bank = currentBank && S.host.moshpit?.[appOfProfile(edit.profile)]?.parameterPage
        const label = Number.isInteger(bank) ? window.SCHEMA.bankLabel(c.do.moshpit.width, bank) : c?.label || ''
        html = mapped ? `${lb(label)}${c.icon ? `<span class="key-glyph">${window.IconLibrary.svg(c.icon)}</span>` : ''}` : '<span class="plus">+</span>'
        title = mapped ? `${info.name}: ${summarize(c.do) || 'nothing'}` : `${info.name}: free`
        if (mapped && window.ControlFeedbackView) {
          const h=S?.host, feedback=h?.keyFeedback?.[info.slot]
          const current=online&&h?.connected&&S?.claim?.owner==='waxyct'&&edit.profile===h.profile&&edit.page===h.page&&feedback?.bindingKey===window.ControlFeedbackView.keyBindingKey(c)
          const kind=c?.state ? (typeof c.state.equals==='boolean'?'toggle':'selection') : ['rigToggle','rigView'].includes(c?.do?.td?.type)?'toggle':c?.do?.td?.type==='rigClip'?'selection':c?.do?.moshpit?.verb==='toggle'?'toggle':c?.do?.moshpit?.verb==='select'?'selection':c?.do?.td?.type==='rigPulse'?'momentary':'plain'
          let reading=current?feedback:{kind,state:'unavailable',enabled:null,selected:null}
          if(home?.highlight===Number(info.slot))reading={kind:'selection',state:'confirmed',selected:true,enabled:null}
          const display=window.ControlFeedbackView.keyView(reading,{label,control:c,color,active:current&&feedback.display?.active===true,dim:current&&feedback.display?.dim===true,iconLines:c.icon?window.IconLibrary.lines(c.icon):[],icon:c.icon?window.IconLibrary.svg(c.icon):''})
          html=display.html
          if(display.description)title+=' · '+display.description
        }
      } else if (info.kind === 'dial') {
        mapped = !!c && (isSet(c.turn) || isSet(c.press))
        const display = mapped ? dialDisplay(info, c) : null
        html = display ? display.html : `<span class="plus">+</span>`
        title = `${info.name}: turn ${summarize(c && c.turn) || 'free'}, press ${summarize(c && c.press) || 'free'}`
        if (display) title += ` · ${display.description}`
      } else if (info.kind === 'wheel') {
        mapped = !!c && (isSet(c.turn) || isSet(c.tap))
        const display = mapped ? dialDisplay(info, c) : null
        html = display ? `${display.html}${display.model ? '' : `<span class="wheel-tap">${esc(c && isSet(c.tap) ? `tap: ${summarize(c.tap)}` : 'tap free')}</span>`}`
          : `<span class="lb">Wheel</span><span class="sm">turn free</span><span class="sm">tap free</span>`
        title = `The wheel: turn ${summarize(c && c.turn) || 'free'}, tap ${summarize(c && c.tap) || 'free'}`
        if (display) title += ` · ${display.description}`
      } else {
        mapped = !!c && (isSet(c.do) || isSet(c.hold))
        const fnRedo = k === 'undo' && c?.do?.moshpit?.verb === 'command' && c.do.moshpit.command === 'edit.undo'
        html = mapped ? `${['a','b','c','d'].includes(k) ? `<span class="physical-id">${k.toUpperCase()}</span>` : ''}<span class="lb">${esc(summarize(c.do) || '')}</span>${isSet(c.hold) ? `<span class="sm">hold: ${esc(summarize(c.hold))}</span>` : ''}` : `<span class="sm">${esc(k === 'keyboard' ? 'kbd' : k)}</span>`
        title = `${info.name}: tap ${summarize(c && c.do) || 'free'}${isSet(c && c.hold) ? `, hold ${summarize(c.hold)}` : ''}`
        if (fnRedo) {
          html = `<span class="lb">${esc(summarize(c.do))}</span><span class="sm">Fn: Redo</span>`
          title += ', Fn + tap: Redo'
        }
      }
    } else if (/^b\d$/.test(k)) {                     // round buttons: MAIN and the pages
      const r = Number(k[1]), main = edit.profile === 'main'
      const n = main ? r : r - 1
      if (handoff) {                                  // EDENA's own round buttons
        el.className = `c page${el.classList.contains('hit') ? ' hit' : ''}${el.classList.contains('seen') ? ' seen' : ''}`
        el.style.setProperty('--kc', pc)
        el.innerHTML = `<span class="rn">${r + 1}</span>`
        el.title = r < 4 ? `EDENA: round ${r + 1} picks one of its pages` : `EDENA: round ${r + 1}`
        continue
      }
      const has = r === 0 || (!main && p && p.pages && p.pages[n] && !handoff)
      const cur = r === 0 ? main && edit.page === 0 : has && n === edit.page
      el.className = `c ${r === 0 ? 'main' : has ? 'page' : 'nopage'}${cur ? ' cur' : ''}${el.classList.contains('hit') ? ' hit' : ''}${el.classList.contains('seen') ? ' seen' : ''}`
      el.style.setProperty('--kc', r === 0 ? COLOR.bone : pc)
      el.innerHTML = `<span class="rn">${r === 0 ? 'M' : r + 1}</span>`
      el.title = r === 0 ? 'Round 1: MAIN, always (hold it 1 s to escape)' : has ? `Round ${r + 1}: page "${p.pages[n].name}"` : `Round ${r + 1}: no page`
      continue
    }
    if(home&&!mapped)html=''
    const unavailable=disconnectedHome&&mapped&&!(info?.kind==='key'&&['profiles','projects','pages','setup','device'].includes(controlOf(info,pg)?.do?.home));
    el.setAttribute('aria-disabled',String(!!unavailable));if(unavailable)title='CT not connected: this control is unavailable'
    if (mapped && isShared(info)) title += ' (on every page)'
    const want = `c ${info.kind === 'key' ? 'key' : info.kind === 'dial' ? 'dial' : info.kind === 'wheel' ? 'wheel' : ''}${mapped ? ' mapped' : ''}${mapped && isShared(info) ? ' shared' : ''}${sel && sel.k === k ? ' sel' : ''}${el.classList.contains('hit') ? ' hit' : ''}${el.classList.contains('seen') ? ' seen' : ''}${el.classList.contains('drop') ? ' drop' : ''}${el.classList.contains('over') ? ' over' : ''}`
    if (el.className !== want) el.className = want
    el.style.setProperty('--kc', color)
    if (el.innerHTML !== html) el.innerHTML = html
    el.title = title
  }
  if (!S?.test) $('#stage-hint').textContent = stageHint()
}
// The one line under the CT that says what a tap does now: the four ways to bind, or the one in progress.
function stageHint() {
  const p = curProfile(), meta = profileList().find((x) => x.id === edit.profile)
  if (armed) return `Tap a control to bind "${armed.name}". Esc cancels.`
  if (learn) return 'Learn: press, turn or touch a control on the CT.'
  if (!S || !profileList().length) return ''
  if (meta && meta.handoff) return 'EDENA draws its own buttons: nothing to map here.'
  if (p && p.pages && p.pages[edit.page] && p.pages[edit.page].status) return 'The status page is drawn by waxyct. Nothing to map.'
  return sel?.info.reserved ? `${sel.info.name} · hold while turning` : sel ? `${sel.info.name} · ${TRIG[sel.trig]}${pending ? ` → ${pending.item.name}` : ''}` : ''
}

// The MAIN status page as the deck host draws it (host/deck-host.mjs, statusKeys), from the snapshot.
function statusCells() {
  const h = S.host || {}, c = h.counts || {}, errs = (h.errors || []).length, own = S.claim && S.claim.owner === 'waxyct'
  const q = own && S.claim.state === 'quiet'
  return [
    ['CT', own ? S.usb.port || '-' : 'offline', own ? 'sage' : 'rose'],
    ['INPUT', q ? 'quiet' : own ? 'live' : '-', q ? 'sand' : own ? 'sage' : 'dust'],
    [`TD ${S.tdPort || ''}`.trim(), S.td.ok === null ? 'checking' : S.td.ok ? 'answering' : 'no answer', S.td.ok ? 'sage' : S.td.ok === null ? 'dust' : 'sand'],
    ['EDENA', S.procs.edena.length ? 'running' : 'not running', S.procs.edena.length ? 'sage' : 'dust'],
    ['CONFIG', errs ? `${errs} to fix` : 'ok', errs ? 'rose' : 'sage'],
    ['KEYS', c.blocked ? `${c.blocked} blocked` : 'ok', c.blocked ? 'sand' : 'sage'],
    ['HEARTBEAT', c.heartbeatLost ? `lost ${c.heartbeatLost}x` : 'steady', c.heartbeatLost ? 'sand' : 'sage'],
    ['UP', S.host && S.host.uptimeMin !== undefined ? `${S.host.uptimeMin} min` : '-', 'dust'], null, null, null,
    ['MAIN', 'round 1', 'bone'],
  ]
}

// ---- selection and the inspector
let sel = null            // { k, info, trig }
let pending = null        // an action from the library still waiting for its value (a shortcut to record...)
function select(k, trig) {
  $('#pop').hidden = true
  pending = null
  if (!k) { sel = null; armed = null } else {
    const info = slotOf(k)
    if (!info) return
    sel = { k, info, trig: trig && info.trigs.includes(trig) ? trig : (sel && sel.k === k ? sel.trig : info.trigs[0]) }
  }
  renderSurface(); renderInspector(); renderLibrary()
}
$('#ct').onclick = (e) => {
  const c = e.target.closest('[data-k]')
  if (!c) return
  const k = c.dataset.k
  if (slotOf(k)?.reserved) { if (armed) arm(null); return view === 'customize' ? select(k) : toast(`${ROTARY_MODIFIERS[k].name}: hold while turning a knob or the wheel.`) }
  if (armed) {
    const item = armed
    arm(null)
    if (c.classList.contains('drop') || slotOf(k)) return slotOf(k) && trigFor(slotOf(k), item) ? dropOn(c, item) : wrongTrig(item)
  }
  if (/^b\d$/.test(k)) {                              // round buttons change the page, as on the CT
    const r = Number(k[1])
    if (r === 0) { const m = profileList().find((x) => x.id === 'main'); if (m) { cancelBindingContext(); edit.profile = 'main'; edit.page = 0; if (view === 'controls' && deckLive) api.post('/api/deck', { type: 'switch', id: 'main', profileOnly: true }); loadProfile('main'); render() } return }
    if (edit.profile === 'main') return
    const n = r - 1, p = curProfile()
    if (p && p.pages && p.pages[n]) goPage(n)
    return
  }
  if (!curPage()) return
  if(view==='controls'&&edit.profile==='main'&&!deckLive){
    const action=controlOf(slotOf(k))?.do?.home
    if(['profiles','projects','pages'].includes(action)){document.querySelector('.profile-picker-toggle')?.click();return}
    if(action==='setup')return setView('customize')
    if(action==='device')return setView('status')
    return toast('CT not connected. Connect the CT before using app and device controls.')
  }
  if(view==='controls'&&edit.profile==='main'&&deckLive&&S?.host?.home){
    const h=S.host.home;if(k.startsWith('center:'))return api.post('/api/home',{kind:'key',slot:Number(k.split(':')[1]),revision:h.revision});
    if(k==='knobCT')return api.post('/api/home',{kind:'select',revision:h.revision});
  }
  if (view !== 'customize') return toast('Open MAP to change this control.')
  select(sel && sel.k === k && !pending ? null : k)
}
$('#insp-close').onclick = () => select(null)

function renderInspector() {
  const has = !!sel && !!curPage()
  $('#insp').hidden = !has
  $('#insp-empty').hidden = true
  $('#shortcut-clear').hidden = !has || !isSet((controlOf(sel?.info) || {})[sel?.trig])
  $('#insp-body').hidden = !has
  if (!has) return
  const { info, trig } = sel, c = controlOf(info) || {}
  const p = curProfile(), pg = curPage()
  if (info.reserved) {
    $('#insp-title').textContent = info.name
    $('#trig').hidden = true
    $('#shortcut-clear').hidden = true
    $('#fields').innerHTML = ''
    $('#bound').className = 'bound'
    $('#bound').innerHTML = `<span class="bk">Fixed modifier</span><span class="bv">Hold while turning any knob or the wheel. ${info.slot === 'keyboard' ? 'Fine keeps frame controls at one frame per detent.' : 'Fast makes larger changes.'}${isSet(c.do) || isSet(c.hold) ? ' Your saved custom binding is retained but inactive on this reserved button.' : ''}</span>`
    return
  }
  $('#insp-title').innerHTML = `${esc(info.name)}<span class="every" title="${isShared(info) ? 'Edits apply to the shared mapping on every page.' : 'Edits apply only to this page.'}">${isShared(info) ? 'All pages / shared' : 'This page only'}</span><small>${esc(p.name)} › ${esc(pg.name || '')}</small>`
  $('#trig').hidden = info.trigs.length < 2   // a key only has a tap: no tabs to choose between
  $('#trig').innerHTML = info.trigs.map((t) => `<button role="tab" class="${t === trig ? 'on' : ''}" data-trig="${t}" aria-selected="${t === trig}">${TRIG[t]}${isSet(c[t]) ? '<i class="dotm" title="bound"></i>' : ''}</button>`).join('')
  const a = c[trig]
  const b = $('#bound')
  if (pending) {
    b.className = 'bound'
    b.innerHTML = `<span class="bk">${TRIG[trig]}: new</span><span class="bv">${esc(pending.item.name)}</span>`
  } else if (isSet(a)) {
    b.className = 'bound'
    b.innerHTML = `<span class="bk">${TRIG[trig]} does</span><span class="bv">${esc(nameOf(a))} <code>${esc(summarize(a))}</code></span><div class="acts"><button class="act sm" id="clearbtn">Clear ${TRIG[trig].toLowerCase()}</button></div>`
  } else {
    b.className = 'bound empty'
    b.innerHTML = `<span class="bk">${TRIG[trig]}</span><span class="bv">Nothing yet. Pick an action below, or drag one onto the control.</span>`
  }
  if (isLocked(info)) { b.className = 'bound'; b.insertAdjacentHTML('beforeend', `<div class="acts"><span class="hint">Locked: ${info.slot === 'home' ? 'home is MAIN' : 'A-D are the transport'} on every standard profile.</span><button class="act sm" id="unlockbtn">Unlock</button></div>`) }
  const inherited = info.kind === 'wheel' ? p.everyPage?.wheel : p.everyPage?.[SECTION[info.kind]]?.[info.slot]
  if (inherited && !isLocked(info)) b.insertAdjacentHTML('beforeend', '<div class="acts"><button class="act sm" id="scopebtn">' + (isShared(info) ? 'Edit this page only' : 'Use shared mapping') + '</button></div>')
  renderFields(c)
}
// A library name for a bound action, when it matches one; else a plain word for its kind.
function nameOf(a) {
  const s = JSON.stringify(a)
  for (const g of library()) for (const it of g.items) if (JSON.stringify(it.act) === s) return it.name
  const k = Object.keys(a).find((x) => KINDS.includes(x))
  return { keys: 'Shortcut', media: 'Media', volume: 'Volume', scroll: 'Scroll', type: 'Type text', launch: 'Launch', focus: 'Bring forward', switch: 'Switch app', page: 'Go to page', td: 'TouchDesigner', macro: 'Macro', main: 'Back to MAIN' }[k] || k
}
$('#trig').onclick = (e) => { const b = e.target.closest('[data-trig]'); if (b) { sel.trig = b.dataset.trig; pending = null; renderInspector(); renderLibrary() } }
$('#bound').onclick = (e) => {
  if (e.target.id === 'scopebtn') {
    if (!sel || sel.info.reserved || isLocked(sel.info)) return
    const onlyThisPage = isShared(sel.info), next = window.EditorModel.withPageControlScope(curProfile(), edit.page, sel.info.kind, sel.info.slot, onlyThisPage)
    const key = sel.k, trigger = sel.trig
    cancelBindingContext()
    const saved = save(next, onlyThisPage ? 'Mapping copied to this page only' : 'Shared mapping restored')
    select(key, trigger)
    return saved
  }
  if (e.target.id === 'clearbtn') bind(sel.k, sel.trig, null, 'Cleared')
  if (e.target.id === 'unlockbtn') { unlocked.add(`${edit.profile}:${sel.info.slot}`); renderInspector() }
}

// The fields under the binding: the key's label and colour, the dial's name, and the action's one value.
const fieldTargets = new WeakMap()
function renderFields(c) {
  const { info, trig } = sel, a = pending ? pending.act : c[trig]
  const parts = []
  const kind = a && Object.keys(a).find((x) => KINDS.includes(x))
  // the action's value, when it has one a person sets
  if (a && ['keys', 'type', 'launch', 'focus', 'volume', 'scroll', 'page'].includes(kind)) {
    const v = a[kind]
    if (kind === 'keys' && Array.isArray(v)) parts.push(`<div class="fld"><label>Turn left, turn right</label><div class="row2"><input class="rec" id="fv" data-rec="1" value="${esc(v[0])}" placeholder="click, then press keys"><input class="rec" id="fv2" data-rec="1" value="${esc(v[1])}" placeholder="click, then press keys"></div>${pending ? '<span class="hint">Click a box and press the shortcut. Or type it, like ctrl+shift+s.</span>' : ''}</div>`)
    else if (kind === 'keys') parts.push(`<div class="fld"><label>Shortcut</label><input class="rec" id="fv" data-rec="1" value="${esc(v)}" placeholder="click, then press keys">${pending ? '<span class="hint">Click the box and press the shortcut. Or type it, like ctrl+shift+s.</span>' : ''}</div>`)
    else parts.push(`<div class="fld"><label>${{ type: 'Text to type', launch: 'Program to open (full path)', focus: 'Program file name', volume: 'Steps (negative is down)', scroll: 'Lines (negative is up)', page: `Page number (1-${LIMITS.pages})` }[kind]}</label><input id="fv" value="${esc(typeof v === 'object' ? v.path : v)}" ${['volume', 'scroll', 'page'].includes(kind) ? 'type="number"' : ''} placeholder="${kind === 'launch' ? 'C:\\Program Files\\App\\app.exe' : kind === 'focus' ? 'Resolve.exe' : ''}"></div>`)
  } else if (a && kind === 'td') {
    const verb = TD_VERBS[a.td.type] || {}
    if (verb.par) parts.push(`<div class="fld"><label>CT_RIG parameter</label><input id="fv" value="${esc(a.td.par || '')}" placeholder="like Glideamt"><span class="hint">One capitalised word: the parameter's name on /project1/CT_RIG.</span></div>`)
    else if (verb.n) parts.push(`<div class="fld"><label>Clip number</label><input id="fv" type="number" min="1" value="${esc(a.td.n || 1)}"></div>`)
  }
  if (a && kind === 'native') parts.push('<div class="fld"><label>App control</label><code>' + esc(summarize(a)) + '</code><span class="hint">Range, default and availability come from the connected app. Choose another app control below to reassign.</span></div>')
  if (pending) parts.push(`<div class="fld"><div class="row2"><button class="act sm primary" id="applybtn">${isSet(c[trig]) ? 'Replace' : 'Bind'} ${esc(info.name)}</button><button class="act sm" id="cancelbtn">Cancel</button></div></div>`)
  // how the control looks on the CT
  if (!pending && info.kind === 'key') {
    parts.push(`<div class="look-row"><div class="fld"><label for="flabel">Label on the key</label><input id="flabel" maxlength="${LIMITS.label}" value="${esc(c.label || '')}" placeholder="Key label"></div><div class="fld"><label for="fcolor">Colour</label><select id="fcolor" style="border-left-color:${COLOR[c.color] || COLOR[curProfile()?.color] || COLOR.bone}"><option value="">App colour</option>${Object.keys(COLOR).map(n => `<option value="${n}"${c.color === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div></div>`)
    parts.push(`<div class="fld"><label>Icon on the key</label><div class="icon-field"><span class="icon-thumb">${window.IconLibrary.svg(c.icon)}</span><span>${esc(c.icon || 'Label only')}${c.iconSource === 'custom' ? ' (custom)' : ' (automatic)'}</span><button type="button" class="act sm" id="ficonbrowse">Choose / edit</button>${c.iconSource === 'custom' ? '<button type="button" class="act sm" id="ficonauto">Use action icon</button>' : ''}</div></div>`)

  }
  if (!pending && info.kind === 'dial') parts.push(`<div class="fld"><label for="flabel">Name on the strip</label><input id="flabel" maxlength="${LIMITS.label}" value="${esc(c.name || '')}" placeholder="like VOLUME"></div>`)
  if (kind === 'type' || kind === 'focus') parts.push('<span class="ed-msg bad" id="binding-error" role="alert"></span>')
  $('#fields').innerHTML = parts.join('')
  for (const input of $$('#fields input, #fields select')) fieldTargets.set(input, captureTarget())
  const f = $('#fv'); if (f && pending) setTimeout(() => f.focus(), 0)
}
// shortcut recorder: a key press in a recording box becomes "ctrl+shift+s"
const KEYNAME = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Escape: 'esc', Enter: 'enter', Tab: 'tab', ' ': 'space', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown' }
$('#fields').addEventListener('keydown', (e) => {
  const t = e.target
  if (t.dataset && t.dataset.rec) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
    if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key.length === 1 || e.key === 'Backspace') && !e.shiftKey && t.selectionStart !== undefined && t.dataset.typed) return   // typing it out
    e.preventDefault()
    const k = KEYNAME[e.key] || (/^F\d{1,2}$/.test(e.key) ? e.key.toLowerCase() : e.key.length === 1 ? e.key.toLowerCase() : null)
    if (!k) return
    t.value = [e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.metaKey && 'win', k].filter(Boolean).join('+')
    commitField(t)
    return
  }
  if (e.key === 'Enter' && t.tagName === 'INPUT') { e.preventDefault(); pending ? applyPending() : commitField(t) }
})
$('#fields').addEventListener('dblclick', (e) => { if (e.target.dataset && e.target.dataset.rec) { e.target.dataset.typed = '1'; e.target.classList.remove('rec') } })
$('#fields').addEventListener('change', (e) => {
  if (!pending && e.target.id === 'fcolor') {
    if (!e.target.isConnected || !validTarget(fieldTargets.get(e.target))) return
    return commitLook({ color: e.target.value || undefined })
  }
  if (!pending && e.target.id === 'ficon') return commitLook({ icon: e.target.value || undefined, iconSource: 'custom' })
  if (!pending && e.target.tagName === 'INPUT') commitField(e.target)
})
$('#fields').addEventListener('click', (e) => {
  if (e.target.id === 'ficonauto') { const c = controlOf(sel.info); const item = library().flatMap(g => g.items).find(it => JSON.stringify(it.act) === JSON.stringify(c.do)); return commitLook({icon:item?.icon, iconSource:'auto'}) }
  if (e.target.closest('#ficonbrowse')) {
    const owner = { profile: edit.profile, page: edit.page, key: sel?.k }
    return window.IconLibrary.open(controlOf(sel.info)?.icon, name => {
      if (owner.profile !== edit.profile || owner.page !== edit.page || owner.key !== sel?.k) { toast('The selected control changed. Reopen the icon picker for its new target.'); return false }
      commitLook({ icon: name || undefined, iconSource: 'custom' })
    })
  }
  if (e.target.id === 'applybtn') applyPending()
  if (e.target.id === 'cancelbtn') { pending = null; renderInspector() }
})
window.addEventListener('ct-icons-changed', () => { renderLibrary(); renderProfileBar(); renderSurface(); if (!editing()) renderInspector() })
function readValue(base) {
  const kind = Object.keys(base).find((x) => KINDS.includes(x)), raw = $('#fv') ? $('#fv').value : '', v = kind === 'type' ? raw : raw.trim()
  if (kind === 'launch' && base.launch && typeof base.launch === 'object') return { launch: { ...base.launch, path: v } }
  if (kind === 'keys' && Array.isArray(base.keys)) return { keys: [v, $('#fv2').value.trim()] }
  if (['volume', 'scroll', 'page'].includes(kind)) return { [kind]: Number(v) }
  if (kind === 'td') { const verb = TD_VERBS[base.td.type] || {}; return { td: { ...base.td, ...(verb.par ? { par: v } : verb.n ? { n: Number(v) || 1 } : {}) } } }
  return { [kind]: v }
}
function assignmentValid(action) {
  const problem = window.EditorModel.assignmentProblem(action)
  if (!problem) return true
  const message = $('#binding-error')
  if (message) message.textContent = problem
  else toast(problem, 'bad')
  return false
}
function applyPending() {
  if (!pending) return
  if (!validTarget(pending.target)) { cancelBindingContext(); renderInspector(); return toast('Binding cancelled: the target changed.') }
  const act = pending.item.param ? readValue(pending.act) : structuredClone(pending.act), item = pending.item
  if (!assignmentValid(act)) return
  pending = null
  bind(sel.k, sel.trig, act, `Bound ${item.name.replace(/…$/, '')}`, item)
}
function commitField(input = document.activeElement) {
  // Change fires after focus has left the input. Use its own value and render-time owner, and
  // reject delayed events from a detached field or a different app/page/control/gesture.
  if (!sel || pending || !input || !input.isConnected || input !== document.getElementById(input.id)
    || !validTarget(fieldTargets.get(input))) return
  const c = controlOf(sel.info) || {}
  if (input.id === 'flabel' || input.id === 'fsub') {
    const field = input.id === 'fsub' ? 'sub' : sel.info.kind === 'dial' ? 'name' : 'label'
    const value = input.value.trim().toUpperCase()
    if (value === (c[field] || '')) return // Enter followed by blur is one edit, not two saves.
    return commitLook({ [field]: value || (field === 'label' ? '' : undefined) })
  }
  const a = c[sel.trig]
  if (a && (input.id === 'fv' || input.id === 'fv2')) {
    const value = readValue(a)
    if (JSON.stringify(value) !== JSON.stringify(a)) bind(sel.k, sel.trig, value, 'Changed')
  }
}
function commitLook(look) {
  const prof = structuredClone(curProfile()), info = sel.info, shared = isShared(info, prof), pg = homeOf(info, prof)
  const sec = { key: 'keys', dial: 'dials' }[info.kind]
  if (!sec) return
  pg[sec] = pg[sec] || {}
  const c = pg[sec][info.slot] = pg[sec][info.slot] || (info.kind === 'key' ? { do: { none: true } } : {})
  for (const [k, v] of Object.entries(look)) { if (v === undefined || v === '') delete c[k]; else c[k] = v }
  if (info.kind === 'dial' && !c.name && !c.turn && !c.press) delete pg[sec][info.slot]
  if (!Object.keys(pg[sec]).length) delete pg[sec]
  tidyEveryPage(prof)
  save(prof, `${info.name}: ${'color' in look ? 'colour' : 'icon' in look ? 'icon' : 'sub' in look ? 'small line' : info.kind === 'dial' ? 'name' : 'label'} changed${shared ? ' (every page)' : ''}`)
}

// The CT profile standard's global layer: on a standard profile (its home button is MAIN on every page) the home
// button and A / B / C / D (the transport) are locked; the inspector's Unlock opens one for this session.
const GLOBAL = ['home', 'a', 'b', 'c', 'd']
const unlocked = new Set()
const isStandard = (p = curProfile()) => !!(p && p.everyPage && p.everyPage.buttons && p.everyPage.buttons.home && p.everyPage.buttons.home.do && p.everyPage.buttons.home.do.main)
const isLocked = (info) => !!info && info.kind === 'button' && GLOBAL.includes(info.slot) && isStandard() && !unlocked.has(`${edit.profile}:${info.slot}`)
// Regeneration preserves edited profiles; a separate candidate can be adopted explicitly with backup.
const generatedFrom = (p = curProfile()) => p && typeof p._help === 'string' && /Generated by scripts\/make-rig-profile\.mjs/.test(p._help) ? `config/rigs/${edit.profile}.json` : null

// ---- binding: the heart of it
// k, trig: the control and which of its triggers; act: the action, or null to clear it.
function bind(k, trig, act, msg, item) {
  if (!assignmentValid(act)) return
  const info = slotOf(k), prof = structuredClone(curProfile())
  if (!info || !prof) return
  if (info.reserved) return toast(`${info.name} is a fixed held modifier; choose another control.`)
  if (isLocked(info)) return toast(`${info.name} is the standard's global layer (${info.slot === 'home' ? 'MAIN' : 'the transport'}). Unlock it in the inspector to change it.`, 'bad')
  const shared = isShared(info, prof), pg = homeOf(info, prof)
  if (info.kind === 'wheel') {
    pg.wheel = pg.wheel || {}
    if (act && !act.none) pg.wheel[trig] = act; else delete pg.wheel[trig]
    if (!Object.keys(pg.wheel).length) delete pg.wheel
  } else {
    const sec = SECTION[info.kind]
    pg[sec] = pg[sec] || {}
    const c = pg[sec][info.slot] = pg[sec][info.slot] || {}
    if (info.kind === 'key' && trig === 'do' && JSON.stringify(c.do) !== JSON.stringify(act)) delete c.state
    if (act && !act.none) c[trig] = act; else delete c[trig]
    if (item && info.kind === 'key' && act && !act.none) applyActionAppearance(c, item)
    if (item && info.kind === 'dial' && trig === 'turn' && act && !c.name && item.label) c.name = item.label
    if (info.kind === 'button' && (isSet(c.hold) || isSet(c.redo)) && !c.do) c.do = { none: true }
    if (info.kind === 'key' && !isSet(c.do)) { if (c.label) c.do = { none: true }; else delete pg[sec][info.slot] }
    if (info.kind !== 'key' && !Object.keys(c).filter((x) => x !== 'name').some((x) => isSet(c[x])) && !c.name) delete pg[sec][info.slot]
    if (info.kind === 'button' && !isSet(c.do) && !isSet(c.hold) && !isSet(c.redo)) delete pg[sec][info.slot]
    if (!Object.keys(pg[sec]).length) delete pg[sec]
  }
  tidyEveryPage(prof)
  if (item) remember(item)
  save(prof, `${msg || 'Bound'} · ${info.name}${act && !act.none ? ` ${TRIG[trig].toLowerCase()}` : ''}${shared ? ' (every page)' : ''}`)
}
// Which trigger an action lands on, dropped on a control: turn actions turn, the rest press or tap.
function trigFor(info, item) {
  if (!info || info.reserved) return null
  if (item.trig === 'turn') return info.trigs.includes('turn') ? 'turn' : null
  if (item.trig === 'press' || item.trig === 'any') {
    if (sel && sel.k === info.k && sel.trig !== 'turn') return sel.trig
    return info.trigs.find((t) => t !== 'turn') || null
  }
  return null
}
const wrongTrig = (item) => toast(item.trig === 'turn' ? `"${item.name}" needs something that turns: a dial or the wheel.` : `"${item.name}" is for a press or tap, not a turn.`, 'bad')
let armed = null          // an action tapped with nothing selected: the next control tapped gets it
function arm(item) {
  armed = armed === item ? null : item
  $('#ct').classList.toggle('arming', !!armed)
  for (const el of $$('#ct .c')) { const info = slotOf(el.dataset.k); el.classList.toggle('drop', !!armed && !!info && !!curPage() && !!trigFor(info, armed)) }
  $$('#lib .it').forEach((b) => b.classList.toggle('armed', !!armed && libItems[Number(b.dataset.i)] === armed))
  $('#stage-hint').textContent = stageHint()
  if (!armed) renderSurface()
}
function dropOn(el, item) {      // an action lands on a control, from a drag or a tap
  const info = slotOf(el.dataset.k), trig = trigFor(info, item), cur = controlOf(info) || {}
  if (isSet(cur[trig]) && JSON.stringify(cur[trig]) !== JSON.stringify(item.act)) return askReplace(el, info, trig, item, cur)
  select(info.k, trig); use(item, info.k)
}
function use(item, k) {          // an action from the library, onto control k (or the selected one)
  if (view !== 'customize') return
  if (!k && !sel) return curPage() ? arm(item) : toast('This page has nothing to map.')
  const info = slotOf(k || (sel && sel.k))
  if (info?.reserved) return toast(`${info.name} is a fixed held modifier; choose another control.`)
  const trig = k ? trigFor(info, item) : (item.trig === 'turn' ? (sel.trig === 'turn' ? 'turn' : null) : sel.trig !== 'turn' ? sel.trig : null)
  if (!trig) return wrongTrig(item)
  if (!sel || sel.k !== info.k) { sel = { k: info.k, info, trig } } else sel.trig = trig
  pending = { item, act: structuredClone(item.act), target: captureTarget() }; renderSurface(); renderInspector(); renderLibrary()
}

// ---- saving: every change is checked by waxyct and saved at once; Undo walks back
const undoStack = [], redoStack = []
function discardProfileHistory(id) {
  for (const stack of [undoStack, redoStack]) for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id === id) stack.splice(i, 1)
}
// Optimistic edits run in order. If a write fails, later snapshots of that profile depend on a
// refused edit: cancel them rather than silently carrying it into a successful whole-profile save.
// Other profiles have independent generations. A new edit after rollback starts a fresh chain.
const saveEpoch = Object.create(null)
let saveChain = Promise.resolve(), saving = 0
function save(prof, msg, opts = {}) {
  const id = opts.id || edit.profile, before = JSON.stringify(cache[id]), epoch = saveEpoch[id] || 0
  cache[id] = prof
  saving++
  setSaved('Saving…', '')
  renderProfileBar()
  const done = saveChain.then(() => {
    if ((saveEpoch[id] || 0) !== epoch) {
      toast('Later edits to this profile were cancelled after a failed save. Please retry them.', 'bad')
      return false
    }
    return doSave(id, before, prof, msg, opts)
  }).finally(() => { saving--; renderProfileBar() })
  saveChain = done.catch(() => {})
  return done
}
async function doSave(id, before, prof, msg, { fromUndo, expectedRevision, resetHistory } = {}) {
  setSaved('Saving…', '')
  let r = { ok: true }
  if (MOCK) window.MOCK_PROFILES[id] = structuredClone(prof)   // the mock's 'disk': edits survive its 5 s re-read
  else r = await fetch('/api/profile', { method: 'POST', headers: { 'X-CT-Router': '1' }, body: JSON.stringify({ id, text: JSON.stringify(prof), expectedRevision: expectedRevision === undefined ? profileRevisions[id] : expectedRevision }) }).then((x) => x.json()).catch(() => ({ ok: false, problems: ['waxyct did not answer'] }))
  if (!r.ok) {
    // Every predecessor in this generation succeeded, so before is acknowledged state.
    saveEpoch[id] = (saveEpoch[id] || 0) + 1
    cache[id] = JSON.parse(before)
    setSaved('Not saved', 'bad')
    toast(`Not saved: ${(r.problems || [r.error]).join('; ')}`, 'bad')
    renderSurface(); renderInspector()
    return false
  }
  if (r.revision !== undefined) profileRevisions[id] = r.revision
  if (resetHistory) discardProfileHistory(id)
  else if (!fromUndo) { undoStack.push({ id, text: before, msg }); redoStack.length = 0 }
  if (undoStack.length > 100) undoStack.shift()
  if (saving > 1) setSaved('Saving…', '')
  else setSaved(`Saved ${new Date().toTimeString().slice(0, 5)}`, 'ok')
  if (!fromUndo) toast(msg, '', true)
  renderSurface(); renderInspector(); renderProfileBar()
  return true
}
async function undo() {
  if (saving) return toast('Wait for the current save before undoing.')
  const u = undoStack.at(-1)
  if (!u) return
  cancelBindingContext()
  if (edit.profile !== u.id) { cancelBindingContext(); navAt = Date.now(); edit.profile = u.id; edit.page = 0; await loadProfile(u.id, true) }
  if (undoStack.at(-1) !== u) return toast('History changed while reloading this profile. Please retry.', 'bad')
  undoStack.pop()
  const redo = { id: u.id, text: JSON.stringify(cache[u.id]), msg: u.msg }
  if (await save(JSON.parse(u.text), '', { fromUndo: true, id: u.id })) { redoStack.push(redo); toast(`Undone: ${u.msg}`) } else undoStack.push(u)
  renderProfileBar()
}
async function redo() {
  if (saving) return toast('Wait for the current save before redoing.')
  const u = redoStack.at(-1)
  if (!u) return
  cancelBindingContext()
  if (edit.profile !== u.id) { cancelBindingContext(); navAt = Date.now(); edit.profile = u.id; edit.page = 0; await loadProfile(u.id, true) }
  if (redoStack.at(-1) !== u) return toast('History changed while reloading this profile. Please retry.', 'bad')
  redoStack.pop()
  const undo = { id: u.id, text: JSON.stringify(cache[u.id]), msg: u.msg }
  if (await save(JSON.parse(u.text), '', { fromUndo: true, id: u.id })) { undoStack.push(undo); toast(`Redone: ${u.msg}`) } else redoStack.push(u)
  renderProfileBar()
}
$('#undobtn').onclick = undo
$('#redobtn').onclick = redo
function setSaved(t, cls) {
  const el = $('#saved'); el.textContent = t; el.className = `saved ${cls}`
  const detail = $('#editor-saved'); detail.textContent = `Autosave · ${t}`; detail.className = `editor-save ${cls}`
}
let toastTimer = null
function toast(msg, cls = '', withUndo = false) {
  const t = $('#toast')
  $('#toast-t').textContent = msg
  t.className = `toast ${cls}`
  $('#toast-undo').hidden = !withUndo
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, withUndo ? 6000 : 4000)
}
$('#toast-undo').onclick = () => { $('#toast').hidden = true; undo() }

// ---- the actions library
const RECENT_KEY = 'waxyct.recent.v2'
let actionScope = null, scopeProfile = null
const collapsedGroups = new Set()
const scopeInfo = { moshpit: ['Moshpit','mosh'], touchdesigner: ['TD','node'], system: ['System','desktop'], navigation: ['Navigate','home'], all: ['All','layers'] }
const categoryIcon = { Recent:'undo', Transport:'play', Browse:'clip', Effects:'effect', Output:'render', Workspaces:'layers', Audio:'volume', Desktop:'desktop', Shortcuts:'keyboard', Custom:'settings', Apps:'home', Pages:'layers' }
function remember(item) {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(x => x !== item.id)
    r.unshift(item.id); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6)))
  } catch {}
}
function library() {
  const items = window.ACTION_LIBRARY.flatMap(g => g.items)
  const apps = appList().filter(a => a.id !== 'main' && a.tier !== 'legacy').map(a => ({id:`app:${a.id}`, app:'navigation', category:'Apps', icon:a.id === 'moshpit' ? 'mosh' : 'node', name:`Open ${a.name}`, label:a.name.toUpperCase().slice(0,10), color:a.color || 'bone', trig:'press', act:{app:a.id}}))
  const p = curProfile()
  const pages = p?.pages?.map((g,i) => ({id:window.EditorModel.actionIdentity(g.editorId || g.enter || g, `page:${edit.profile}`), app:'navigation', category:'Pages', icon:'layers', name:`Open ${g.name || `page ${i + 1}`}`, label:(g.name || `PAGE ${i + 1}`).toUpperCase().slice(0,10), color:'dust', trig:'press', act:{page:i+1}})) || []
  const assigned = window.EditorModel.profileControlActions(p, appOfProfile(edit.profile) || 'profile')
  const all = [...items,...assigned,...apps,...pages].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
  const groups = []
  for (const item of all) {
    let group = groups.find(g => g.cat === item.category && g.app === item.app)
    if (!group) { group = {cat:item.category,app:item.app,items:[]}; groups.push(group) }
    group.items.push(item)
  }
  let recent = []
  try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch {}
  const rec = recent.map(id => all.find(x => x.id === id)).filter(Boolean)
  if (rec.length) groups.unshift({cat:'Recent',app:'all',items:rec})
  return groups
}
let libItems = []
function renderLibrary() {
  const scopes = {...scopeInfo}, appId = appOfProfile(edit.profile)
  if (appId && !scopes[appId] && window.EditorModel.profileControlActions(curProfile(), appId).length) scopes[appId] = [appList().find(a => a.id === appId)?.name || curProfile()?.name || appId, 'effect']
  if (scopeProfile !== edit.profile) { scopeProfile = edit.profile; actionScope = scopes[appId] ? appId : 'system' }
  actionScope ||= 'system'
  const q = $('#q').value.trim().toLowerCase()
  const want = sel ? (sel.trig === 'turn' ? 'turn' : 'press') : null
  $('#action-scopes').innerHTML = Object.entries(scopes).map(([id,[name,icon]]) => `<button class="scope${actionScope === id ? ' on' : ''}" data-scope="${id}" aria-pressed="${actionScope === id}"><span aria-hidden="true">${window.IconLibrary.svg(icon)}</span>${name}</button>`).join('')
  libItems = []
  const html = library().map(g => {
    const items = g.items.filter(it => (actionScope === 'all' || it.app === actionScope) && (!q || `${g.cat} ${scopes[it.app]?.[0]} ${it.name} ${summarize(it.act)}`.toLowerCase().includes(q)))
    if (!items.length) return ''
    const id = `${g.app}:${g.cat}`, open = !!q || !collapsedGroups.has(id)
    return `<details class="action-group" data-group="${esc(id)}"${open ? ' open' : ''}><summary><span class="category-glyph" aria-hidden="true">${window.IconLibrary.svg(categoryIcon[g.cat] || 'more')}</span><span>${actionScope === 'all' && g.cat !== 'Recent' ? `${scopes[g.app]?.[0] || ''} / ` : ''}${esc(g.cat)}</span><span class="n">${items.length}</span></summary>` + items.map(it => {
      const i = libItems.push(it) - 1, off = sel?.info.reserved || (want && it.trig !== 'any' && it.trig !== want)
      return `<button class="it${off ? ' off' : ''}${armed?.id === it.id || pending?.item.id === it.id ? ' armed' : ''}" draggable="${!off}" data-i="${i}" aria-disabled="${!!off}" title="${esc(off ? `Requires ${it.trig}; choose a compatible control or gesture.` : `Select ${it.name}`)}"><span class="action-glyph" style="color:${COLOR[it.color] || COLOR.bone}" aria-hidden="true">${window.IconLibrary.svg(it.icon)}</span><span class="nm">${esc(it.name)}</span><span class="tg">${it.trig === 'any' ? 'Any' : it.trig === 'turn' ? 'Turn' : 'Press'}</span></button>`
    }).join('') + '</details>'
  }).join('')
  $('#lib').innerHTML = html || `<div class="lib-empty">No actions${q ? ` match “${esc(q)}”` : ' in this scope'}. <button class="act sm" data-all-actions>Search all apps</button></div>`
}
$('#q').oninput = renderLibrary
$('#action-scopes').onclick = e => { const b=e.target.closest('[data-scope]'); if(b) {actionScope=b.dataset.scope;renderLibrary()} }
$('#lib').addEventListener('toggle', e => { if(e.target.matches('.action-group') && !$('#q').value.trim()) { e.target.open ? collapsedGroups.delete(e.target.dataset.group) : collapsedGroups.add(e.target.dataset.group) } }, true)
$('#lib').onclick = e => {
  if(e.target.closest('[data-all-actions]')) {actionScope='all';return renderLibrary()}
  const b = e.target.closest('[data-i]'); if(b) use(libItems[Number(b.dataset.i)])
}

// drag an action onto a control: valid drops light up; a bound control asks before replacing
let dragItem = null
$('#lib').addEventListener('dragstart', (e) => {
  const b = e.target.closest('[data-i]')
  if (!b || b.getAttribute('aria-disabled') === 'true' || view !== 'customize') return e.preventDefault()
  if (armed) arm(null)
  dragItem = libItems[Number(b.dataset.i)]
  e.dataTransfer.setData('text/plain', dragItem.name)
  e.dataTransfer.effectAllowed = 'copy'
  $('#ct').classList.add('dragging')
  for (const el of $$('#ct .c')) { const info = slotOf(el.dataset.k); el.classList.toggle('drop', !!info && !!curPage() && !!trigFor(info, dragItem)) }
})
$('#lib').addEventListener('dragend', () => { dragItem = null; $('#ct').classList.remove('dragging'); $$('#ct .c.drop, #ct .c.over').forEach((el) => el.classList.remove('drop', 'over')) })
$('#ct').addEventListener('dragover', (e) => { const c = e.target.closest('.c.drop'); if (c) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $$('#ct .c.over').forEach((x) => x !== c && x.classList.remove('over')); c.classList.add('over') } })
$('#ct').addEventListener('dragleave', (e) => { const c = e.target.closest('.c.over'); if (c && !c.contains(e.relatedTarget)) c.classList.remove('over') })
$('#ct').addEventListener('drop', (e) => {
  const c = e.target.closest('.c.drop')
  if (!c || !dragItem) return
  e.preventDefault()
  const item = dragItem
  $('#lib').dispatchEvent(new Event('dragend'))
  dropOn(c, item)
})
function askReplace(el, info, trig, item, cur) {
  const target = captureTarget(info.k, trig)
  const stillHere = () => target.profile === edit.profile && target.page === edit.page && target.revision === contextRevision
  const pop = $('#pop'), r = el.getBoundingClientRect()
  const canHold = info.kind === 'button' && trig === 'do' && !isSet(cur.hold) && item.trig !== 'turn'
  $('#pop-t').innerHTML = `${esc(info.name)} ${TRIG[trig].toLowerCase()} already does <b>${esc(summarize(cur[trig]) || nameOf(cur[trig]))}</b>.`
  $('#pop-hold').hidden = !canHold
  pop.hidden = false
  pop.style.left = `${Math.min(window.innerWidth - 280, Math.max(10, r.left + r.width / 2 - 130))}px`
  pop.style.top = `${Math.min(window.innerHeight - 120, r.bottom + 8)}px`
  const close = () => { pop.hidden = true }
  $('#pop-replace').onclick = () => { close(); if (!stillHere()) return; select(info.k, trig); use(item, info.k) }
  $('#pop-hold').onclick = () => { close(); if (!stillHere()) return; select(info.k, 'hold'); sel.trig = 'hold'; if (item.param) { pending = { item, act: structuredClone(item.act), target: captureTarget() }; renderInspector() } else bind(info.k, 'hold', structuredClone(item.act), `Bound ${item.name}`, item) }
  $('#pop-cancel').onclick = close
  $('#pop-replace').focus()
}

// ---- the other tools
let fileTarget = null
$('#filebtn').onclick = async () => {
  const id = edit.profile, before = cache[id], context = contextRevision
  if (!id) return
  if (saving) return toast('Wait for the current save before opening the file.')
  let r
  try { r = MOCK ? { text: JSON.stringify(curProfile(), null, 2) } : await fetch('/api/profile', { method: 'POST', headers: { 'X-CT-Router': '1' }, body: JSON.stringify({ id }) }).then((x) => x.json()) }
  catch { return toast('Profile could not be loaded. Please retry.', 'bad') }
  if (saving || edit.profile !== id || contextRevision !== context || cache[id] !== before) return toast('Profile changed while loading the file. Please retry.', 'bad')
  if (!r.text) return toast(r.error || 'Profile could not be loaded.', 'bad')
  fileTarget = {id, revision:r.revision, repair:!!r.problems?.length}
  let loaded
  try { loaded = JSON.parse(r.text) } catch { fileTarget.repair = true }
  // File edits and their Undo must start at the same version the textarea shows.
  if (fileTarget.repair || (profileRevisions[id] !== undefined && profileRevisions[id] !== r.revision)) discardProfileHistory(id)
  profileRevisions[id] = r.revision
  if (!fileTarget.repair) cache[id] = loaded
  cancelBindingContext(); renderSurface(); renderInspector(); renderLibrary(); renderProfileBar()
  $('#file-title').textContent = 'profiles/' + id + '.json'
  $('#file-text').value = r.text
  $('#file-msg').textContent = fileTarget.repair ? 'Repair this profile. A successful repair starts new history; the original file is kept in disk history.' : 'Anything the editor does not cover. A mistake is never applied; the last good version keeps running.'
  $('#file-msg').className = 'ed-msg'
  $('#filedlg').showModal()
}
$('#file-close').onclick = () => $('#filedlg').close()
$('#file-folder').onclick = () => api.post('/api/open-config', {})
$('#file-reload').onclick = () => { cancelBindingContext(); $('#filedlg').close(); api.post('/api/deck', { type: 'reload' }); loadProfile(fileTarget?.id || edit.profile, true) }
$('#file-save').onclick = async () => {
  let prof
  try { prof = JSON.parse($('#file-text').value) } catch (e) { $('#file-msg').textContent = `Not saved: not valid JSON (${e.message})`; $('#file-msg').className = 'ed-msg bad'; return }
  if (!fileTarget) return
  if (await save(prof, 'Saved the file', {id:fileTarget.id,expectedRevision:fileTarget.revision,resetHistory:fileTarget.repair})) $('#filedlg').close()
  else { $('#file-msg').textContent = 'Not saved: see the message at the bottom.'; $('#file-msg').className = 'ed-msg bad' }
}
$('#escbtn').onclick = () => api.post('/api/deck', { type: 'escape' })
let learn = false
$('#activatebtn').onclick = async () => { const id = edit.profile, page = edit.page + 1; cancelBindingContext(); navAt = Date.now(); await api.post('/api/deck', {type:'switch', id, page, profileOnly:true}); renderInspector() }
$('#learnbtn').onclick = () => { learn = !learn; $('#learnbtn').classList.toggle('on', learn); $('#stage-hint').textContent = stageHint(); if (!learn) renderSurface() }
function setView(v) {
  if (v === 'buttons') v = 'customize'
  if (v !== view) cancelBindingContext()
  view = v
  $('#app').dataset.view = v
  $$('.view-tab').forEach((t) => { t.classList.toggle('on', t.dataset.view === v); t.setAttribute('aria-selected', t.dataset.view === v) })
  $('#v-buttons').hidden = v === 'status'
  $('#v-status').hidden = v !== 'status'
  $('.profilebar').hidden = v === 'status'
  if (v === 'status') profilePicker.close()
  render(); renderInspector(); renderLibrary()
}
$$('.view-tab').forEach((t) => (t.onclick = () => setView(t.dataset.view)))
$('#pill').onclick = () => setView('status')
$('#banner').onclick = (e) => { if (e.target.dataset.go) setView(e.target.dataset.go); if (e.target.dataset.take) api.post('/api/owner', { to: 'waxyct' }) }
$('#ct-note').onclick = (e) => { if (e.target.dataset.take) api.post('/api/owner', { to: e.target.dataset.take }) }
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return   // the File dialog and the confirm have their own keys
  const typing = e.target.closest && e.target.closest('input, textarea')
  if (view === 'customize' && e.ctrlKey && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo() }
  else if (view === 'customize' && e.ctrlKey && !typing && e.key === 'y') { e.preventDefault(); redo() }
  else if (e.key === 'Escape' && !typing && !$('#pop').hidden) $('#pop').hidden = true
  else if (e.key === 'Escape' && !typing && armed) arm(null)
  else if (e.key === 'Escape' && !typing && (sel || pending)) { cancelBindingContext(); renderInspector(); renderSurface(); renderLibrary() }
  else if (view === 'customize' && (e.key === 'Delete' || e.key === 'Backspace') && !typing && sel && isSet((controlOf(sel.info) || {})[sel.trig])) bind(sel.k, sel.trig, null, 'Cleared')
  else if (e.key === '/' && !typing && view !== 'status') { e.preventDefault(); setView('customize'); $('#q').focus() }
})

// ---- live presses: flash on the surface; in Learn they pick the control; in the test they count
const MAP_KEYS = [...window.SCHEMA.DIALS.map((d) => `knob${d}`), 'knobCT', 'left', 'right', ...KEY_IDS, ...Array.from({ length: LIMITS.pages + 1 }, (_, i) => `b${i}`), ...SQ_L, ...SQ_R]
function cellFor(m) {
  if (m.ev === 'touch') return m.screen === 'center' ? `center:${m.key}` : m.screen === 'knob' ? 'knobCT' : m.screen
  return typeof m.id === 'number' ? `b${m.id}` : m.id
}
const seen = new Set()
function lightCell(m) {
  const k = cellFor(m), el = document.querySelector(`#ct [data-k="${CSS.escape(k)}"]`) || (S?.test && document.querySelector(`#ct [data-display="${CSS.escape(k)}"]`))
  if (learn && slotOf(k)) {
    learn = false; $('#learnbtn').classList.remove('on')
    setView('customize')
    select(k, m.ev === 'rotate' ? 'turn' : k === 'knobCT' ? 'tap' : /^knob/.test(k) ? 'press' : 'do')
  }
  if (S && S.test) {
    const what = m.ev === 'touch' ? `touch ${m.screen}${m.key !== undefined ? ' key ' + (m.key + 1) : ''}` : `${m.ev} ${m.id}${m.delta ? ` ${m.delta > 0 ? '+' : ''}${m.delta}` : ''}`
    $('#test-last').textContent = el ? what : `${what} (not on the map)`
    if (el) { seen.add(k); el.classList.add('seen') }
  }
  if (!el) return
  el.classList.add('hit')
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.remove('hit'), 180)
  renderTest()
}
function renderTest() {
  const on = !!(S && S.test)
  const b = $('#testbtn')
  b.textContent = on ? 'Stop test' : 'Input test'
  b.classList.toggle('on', on)
  b.disabled = !S || !!S.busy || !online || (!on && !S.usb.present)
  $('#test-meta').hidden = !on
  $('.legend .hint').hidden = on
  const n = MAP_KEYS.filter((k) => seen.has(k)).length
  $('#test-count').textContent = `${n} of ${MAP_KEYS.length}`
  $('#test-meter').style.width = `${(100 * n) / MAP_KEYS.length}%`
}
$('#testbtn').onclick = () => {
  const on = !(S && S.test)
  if (on) { seen.clear(); $$('#ct .c, #ct [data-display]').forEach((c) => c.classList.remove('seen', 'hit')); $('#test-last').textContent = 'Touch every control.' }
  api.post('/api/test', { on })
}

// =====================================================================================================
// the console, actions to the router, and the data feed
// =====================================================================================================
const LOG = []
let filter = 'all'
const SRCS = ['all', 'router', 'bridge', 'edena', 'probe', 'host']
$('#filters').innerHTML = SRCS.map((k) => `<button data-src="${k}" class="${k === filter ? 'on' : ''}">${k === 'host' ? 'deck' : k}</button>`).join('')
$('#filters').onclick = (e) => {
  const k = e.target.dataset.src
  if (!k) return
  filter = k
  $$('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.src === k))
  $('#log').innerHTML = ''
  LOG.forEach(addLine)
  if (!$('#log').childElementCount) $('#log').innerHTML = '<div class="empty">Nothing yet.</div>'
}
const LEVEL = (l) => /FAILED|error|exited \(code [1-9]|HEARTBEAT|stuck/i.test(l) ? 'bad' : /WARNING|waiting|quiet|timed out|not answering/i.test(l) ? 'warn' : ''
function addLine(e) {
  if (filter !== 'all' && e.src !== filter) return
  const log = $('#log')
  log.querySelector('.empty')?.remove()
  const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 8
  const msg = e.line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, ''), key = `${e.src}|${msg.slice(0, 28)}`
  const last = log.lastElementChild
  if (last && last.dataset.key === key) {
    const n = Number(last.dataset.n || 1) + 1
    last.dataset.n = n
    last.querySelector('.t').textContent = new Date(e.t).toTimeString().slice(0, 8)
    last.querySelector('.m').textContent = `${msg}  ×${n}`
    if (pinned) log.scrollTop = log.scrollHeight
    return
  }
  const div = document.createElement('div')
  div.dataset.key = key
  div.className = `ln ${LEVEL(e.line)}`
  const t = document.createElement('span'); t.className = 't'; t.textContent = new Date(e.t).toTimeString().slice(0, 8)
  const s = document.createElement('span'); s.className = `src s-${e.src}`; s.textContent = e.src === 'host' ? 'deck' : e.src
  const m = document.createElement('span'); m.className = 'm'; m.textContent = msg
  div.append(t, s, m)
  log.appendChild(div)
  while (log.childElementCount > 800) log.firstChild.remove()
  if (pinned) log.scrollTop = log.scrollHeight
}
function pushLog(e) { LOG.push(e); if (LOG.length > 800) LOG.shift(); addLine(e) }
$('#copybtn').onclick = async () => {
  const text = $$('#log .ln').map((d) => d.textContent).join('\n')
  try { await navigator.clipboard.writeText(text); $('#copybtn').textContent = 'Copied'; setTimeout(() => ($('#copybtn').textContent = 'Copy'), 1200) } catch {}
}

const api = {
  post: async (url, body) => {
    if (MOCK) return {ok:true}
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CT-Router': '1' }, body: JSON.stringify(body) })
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || `waxyct said ${r.status}`, 'bad'); return {ok:false} }
    return {ok:true}
  },
}
$$('.tile').forEach((t) => (t.onclick = () => { dismissed = S.error ? S.error.id : ''; api.post('/api/owner', { to: t.dataset.to }) }))
$('#checks').onclick = async (e) => {
  const h = e.target.closest('[data-health-all]')
  if (h) { healthAll = !!h.dataset.healthAll; return renderChecks() }
  const b = e.target.closest('[data-autostart]'); if (b) await api.post('/api/autostart', { on: !!b.dataset.autostart })
}
$('#fixbtn').onclick = () => { fixStart = now(); render() }
$('#fixstop').onclick = () => { fixStart = 0; render() }
$('#alerts').onclick = (e) => {
  const run = e.target.dataset.run
  if (run === 'replug') { fixStart = now(); render() }
  if (run === 'dismiss') { dismissed = S.error.id; render() }
  if (run === 'force') confirmForce(S.error)
}
function confirmForce(e) {
  const dlg = $('#confirm')
  $('#confirm-title').textContent = `Force stop ${e.forceName || e.force}`
  $('#confirm-text').textContent = `This ends ${e.forceName || e.force} without its clean close. The CT may be left stuck: waxyct's next open tries to unstick it, and if that fails, the guided replug clears it.`
  $('#confirm-no').onclick = () => dlg.close()
  $('#confirm-yes').onclick = () => { dlg.close(); api.post('/api/force', { target: e.force }) }
  dlg.showModal()
}

window.WAXY = {
  status(s) {
    // the router now runs another build than the one this page was loaded with: load the new page
    if (s.build && pageBuild && s.build.commit !== pageBuild.commit) return location.reload()
    if (s.build && !pageBuild) pageBuild = s.build
    const first = !S
    S = s; skew = Date.now() - s.now; online = true; render()
    const inventoryKey = JSON.stringify([s.host?.apps||s.configuration?.apps,s.host?.profiles||s.configuration?.profiles])
    if (first || inventoryKey !== projectInventoryKey) { projectInventoryKey = inventoryKey; refreshProjects() }
    if (first) renderLibrary()
  },
  log: pushLog,
  input: lightCell,
  offline() {
    online = false
    S ??= { now: Date.now(), usb: { present: false }, replug: {}, claim: null, procs: { edena: [], bridges: [], loupedeck: [] }, td: { ok: null }, hooks: {}, steps: [] }
    render()
  },
  clearLog() { LOG.length = 0; $('#log').innerHTML = '' },
  resetView() { fixStart = 0; seen.clear(); dismissed = ''; $$('#ct .c, #ct [data-display]').forEach((c) => c.classList.remove('seen', 'hit')) },
  setFix(t) { fixStart = t },
  setView, select, api,
}
setInterval(render, 1000)   // relative times and the replug countdown tick between snapshots
renderLibrary()

if (MOCK) {
  const sc = document.createElement('script'); sc.src = 'mock.js'; document.body.appendChild(sc)
} else {
  const es = new EventSource('/events')
  es.onopen = () => WAXY.clearLog()   // the router replays its log on every connect
  es.addEventListener('status', (e) => WAXY.status(JSON.parse(e.data)))
  es.addEventListener('log', (e) => pushLog(JSON.parse(e.data)))
  es.addEventListener('input', (e) => lightCell(JSON.parse(e.data)))
  es.addEventListener('panel',e=>{const intent=JSON.parse(e.data).intent;if(intent==='setup')setView('customize');if(intent==='device')setView('status')})
  es.onerror = () => WAXY.offline()
}
