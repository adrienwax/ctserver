// Mocked states for designing and checking the panel without the router or the CT.
// Open /?mock (or /?mock=<name>). Loaded only then; the live panel never fetches this file.
'use strict'
;(async () => {
  const EDENA_EXE = 'X:\\ExampleApps\\edena\\release\\win-unpacked\\EDENA.exe'
  const t0 = Date.now()
  // the real profiles, never a copy: from the router (/api/profiles), or, opened from a plain file server at the
  // repo root (/ui/index.html?mock), from config/profiles/ itself. The editor edits them in memory, never on disk.
  const fromFolder = async () => {
    const list = await fetch('../config/profiles/', { cache: 'no-store' }).then((r) => r.text())
    const ids = [...list.matchAll(/href="([a-z0-9-]+)\.json"/g)].map((m) => m[1])
    return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await fetch(`../config/profiles/${id}.json`, { cache: 'no-store' }).then((r) => r.json())])))
  }
  window.MOCK_PROFILES = await fetch('/api/profiles').then((r) => { if (!r.ok) throw new Error(r.status); return r.json() }).catch(fromFolder).catch(() => ({}))
  const P = window.MOCK_PROFILES
  // the apps, the same way: the router's /api/apps, or config/apps.json from a file server
  const A = Object.fromEntries(Object.entries(await fetch('/api/apps').then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
    .catch(() => fetch('../config/apps.json', { cache: 'no-store' }).then((r) => r.json())).catch(() => ({}))).filter(([id]) => !id.startsWith('_')))
  const appOf = (x) => (typeof x.app === 'string' ? x.app : null)
  const tierOf = (x) => (x.tier === 'legacy' || (A[appOf(x)] || {}).tier === 'legacy' ? 'legacy' : 'current')
  const host = (profile = 'template', page = 1) => ({ apps: Object.entries(A).map(([id, a]) => ({ id, name: a.name, color: a.color, target: a.target, tier: a.tier === 'legacy' ? 'legacy' : 'current', exe: a.exe || null, running: a.exe ? a.target !== 'handoff' : null, default: a.default || null })),
    profile, page, profileName: P[profile].name, pageName: (P[profile].pages || [])[page]?.name || '', connected: true, errors: [],
    profiles: Object.entries(P).map(([id, x]) => ({ id, name: x.name, color: x.color, handoff: !!x.handoff || (A[appOf(x)] || {}).target === 'handoff', pages: (x.pages || []).map((g) => g.name), app: (A[appOf(x)] || {}).exe || null, running: appOf(x) ? (A[appOf(x)] || {}).target !== 'handoff' : null, appId: appOf(x), tier: tierOf(x), pick: false })) })
  const at = (s) => t0 + s * 1000
  const since = (s) => Date.now() - s * 1000
  const base = () => ({
    now: Date.now(),
    usb: { present: true, port: 'COM4' },
    replug: { goneAt: 0, backAt: 0 },
    claim: null,
    procs: { edena: [], edenaMain: null, bridges: [], loupedeck: [] },
    td: { ok: true, detail: 'TouchDesigner 2021.16410' },
    power: { suspend: { ac: 0, dc: 0 }, hub: { name: 'USB Root Hub (USB 3.0)', allowOff: true } },
    hooks: { bridge: true, edena: true },
    edena: { kind: 'build', cmd: EDENA_EXE, hooks: true },
    busy: null, target: null, steps: [], error: null, test: null, autostart: false,
    children: { bridge: null, probe: null, host: 5120 }, host: host(),
    note: '',
  })
  const claim = (owner, state, extra = {}) => ({ owner, pid: owner === 'edena' ? 4242 : 5476, state, port: 'COM4', since: since(754), updated: Date.now() - 400, lastInput: since(2), lastEvent: 'rotate knobTL', ...extra })
  const edenaOpen = (hooks = true) => ({ edena: [4242], edenaMain: { pid: 4242, name: 'EDENA.exe', exe: EDENA_EXE, hooks }, bridges: [], loupedeck: [] })

  const S = {
    deck: () => ({ ...base(), claim: claim('waxyct', 'connected', { pid: 5120, lastEvent: 'rotate knobTL' }), note: 'waxyct holds the CT' }),
    'deck-td': () => ({ ...S.deck(), host: host('template', 1) }),
    'deck-mosh': () => ({ ...S.deck(), host: { ...host('moshpit', 1), moshpit: { moshpit: { phase: 'connected', detail: 'Mock project', project: 'Mock project', slots: ['Hold', 'Melt', 'Tone'] } } } }),
    'mosh-off': () => ({ ...S.deck(), host: { ...host('moshpit', 1), moshpit: { moshpit: { phase: 'waiting', detail: 'closed; retrying in 3 s (is Moshpit open?)', project: null, slots: [] } } } }),
    'deck-bad': () => ({ ...S.deck(), host: { ...host(), errors: [{ file: 'profiles/td.json', problems: ['pages[0].keys.3.label: "tap!" has a character the CT cannot draw'] }] } }),
    free: () => ({ ...base(), note: 'the CT is free' }),
    td: () => ({ ...base(), claim: claim('td-bridge', 'connected', { lastInput: since(1), lastEvent: 'rotate knobCT' }), children: { bridge: 5476 }, note: 'the TD bridge holds the CT' }),
    edena: () => ({ ...base(), claim: claim('edena', 'connected', { lastEvent: 'touchstart center' }), procs: edenaOpen(), note: 'EDENA holds the CT' }),
    away: () => ({ ...S.td(), procs: edenaOpen(), note: 'the TD bridge holds the CT; EDENA stays open' }),
    handoff: () => {
      const e = (Date.now() - t0) / 1000 % 8
      const st = (i) => (e > [0, 1.5, 3, 5.5][i] + 1.4 ? 'done' : e > [0, 1.5, 3, 5.5][i] ? 'doing' : 'todo')
      return { ...base(), claim: e < 2.9 ? claim('td-bridge', 'connected') : e > 6.9 ? claim('edena', 'connecting') : null, procs: e > 4 ? edenaOpen() : base().procs,
        busy: 'handing the CT to EDENA', target: 'edena',
        steps: [{ label: 'The TD bridge blanks the CT and closes it', state: st(0) }, { label: 'The claim is gone and the port is free', state: st(1) }, { label: 'Starting EDENA from its build', state: st(2) }, { label: 'EDENA takes the CT', state: st(3) }] }
    },
    closing: () => ({ ...base(), claim: claim('td-bridge', 'closing'), children: { bridge: 5476 }, busy: 'handing the CT to nobody', target: 'none',
      steps: [{ label: 'Checking nothing outside waxyct holds the CT', state: 'done' }, { label: 'The TD bridge blanks the CT and closes it', state: 'doing' }] }),
    quiet: () => ({ ...base(), claim: claim('td-bridge', 'quiet', { lastInput: since(47), lastEvent: 'rotate knobBR' }), children: { bridge: 5476 } }),
    lost: () => ({ ...base(), claim: claim('edena', 'heartbeat-lost', { heartbeatLost: 2 }), procs: edenaOpen() }),
    'td-offline': () => ({ ...S.td(), td: { ok: false, detail: 'no answer on 9981: TouchDesigner is closed or its bridge is not running' } }),
    unplugged: () => ({ ...base(), usb: { present: false, port: null }, claim: claim('edena', 'not-found', { lastInput: since(95) }), procs: edenaOpen() }),
    unknown: () => ({ ...base(), procs: { ...base().procs, loupedeck: ['LogiPluginService.exe'] } }),
    'old-edena': () => ({ ...base(), procs: edenaOpen(false) }),
    error: () => ({ ...S.edena(), claim: claim('edena', 'connected'),
      steps: [{ label: 'Asking EDENA to let go of the CT', state: 'fail' }],
      error: { id: 'e1', side: 'EDENA', what: 'EDENA did not let go in 10 s', fix: 'EDENA got --ct=release and did not close the CT. It may be busy or hung. Wait and try again, or force stop it: waxyct quits it, then ends it if it does not close.', force: 'edena', forceName: 'EDENA' } }),
    test: () => ({ ...base(), claim: claim('probe', 'connected', { since: since(20) }), test: { prev: 'td', counts: {} }, children: { probe: 6100 }, note: 'input test running' }),
    replug: () => {
      const e = (Date.now() - t0) / 1000
      const goneAt = e > 2 ? at(2) : 0, backAt = e > 8.5 ? at(8.5) : 0
      const cl = e < 2 ? claim('td-bridge', 'quiet', { lastInput: since(60) }) : e < 10.5 ? claim('td-bridge', 'disconnected', { lastInput: since(60) }) : claim('td-bridge', 'connected', { updated: Date.now(), lastInput: e > 12.5 ? at(12.5) : since(60) })
      return { ...base(), usb: { present: !(e > 2 && e < 8.5), port: e > 2 && e < 8.5 ? null : 'COM4' }, replug: { goneAt, backAt }, claim: cl, children: { bridge: 5476 } }
    },
    offline: null,
  }

  const LOGS = [
    ['router', 'waxyct on http://127.0.0.1:9990  (bridge: X:\\ExampleApps\\ct-td-control  edena: X:\\ExampleApps\\edena)'],
    ['router', 'the CT is free; handing it to the TD bridge'],
    ['router', 'bridge started (pid 5476)'],
    ['bridge', '2026-09-27T21:40:02.118Z opening CT...'],
    ['bridge', '2026-09-27T21:40:02.301Z CT open on COM4'],
    ['bridge', '2026-09-27T21:40:02.305Z key labels match the rig: 17 generators, 22 effects'],
    ['bridge', '2026-09-27T21:40:02.306Z LIVE. Turn dials, spin the wheel, tap keys and buttons. Ctrl-C to stop.'],
    ['router', 'the TD bridge holds the CT'],
    ['edena', '[ct] router: release'],
    ['bridge', '2026-09-27T21:41:30.004Z WARNING: no CT input for 21 s - if you have been turning dials, the CT may have gone quiet: replug it'],
    ['router', 'FAILED: EDENA did not let go in 10 s'],
  ]
  const names = Object.keys(S)
  let cur = new URLSearchParams(location.search).get('mock') || 'deck'
  if (!names.includes(cur)) cur = 'deck'

  const bar = document.createElement('div')
  bar.className = 'mockbar'
  bar.innerHTML = names.map((n) => `<button data-m="${n}">${n}</button>`).join('')
  if (!new URLSearchParams(location.search).has('bare')) document.body.appendChild(bar)   // &bare: for screenshots
  bar.onclick = (e) => { if (e.target.dataset.m) pick(e.target.dataset.m) }

  let testTimer = null
  function pick(n) {
    cur = n
    history.replaceState(null, '', `?mock=${n}${new URLSearchParams(location.search).has('bare') ? '&bare' : ''}`)
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === n))
    WAXY.resetView()
    clearInterval(testTimer)
    if (n === 'replug') WAXY.setFix(t0 + 500)
    if (n === 'test') {
      const seq = ['knobTL', 'knobCL', 'knobBL', 'knobTR', 'knobCR', 'knobBR', 'knobCT'].map((id) => ({ ev: 'rotate', id, delta: 1 }))
        .concat(Array.from({ length: 12 }, (_, key) => ({ ev: 'touch', screen: 'center', key })), [0, 1, 2, 3, 4].map((id) => ({ ev: 'down', id })), [{ ev: 'touch', screen: 'left' }, { ev: 'down', id: 'home' }, { ev: 'down', id: 'fnR' }])
      let i = 0
      testTimer = setInterval(() => { if (i < seq.length) WAXY.input(seq[i++]) }, 260)
    }
    tick()
  }
  function tick() {
    if (!S[cur]) return WAXY.offline()
    WAXY.status(S[cur]())
  }
  WAXY.status(S.free())
  LOGS.forEach(([src, line], i) => WAXY.log({ t: t0 - (LOGS.length - i) * 7000, src, line }))
  pick(cur)
  setInterval(tick, 500)
  window.MOCK = { pick, names }
})()
