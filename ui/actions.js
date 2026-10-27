// The actions library: everything a CT control can be bound to, grouped the way the right-hand pane
// shows them. Each entry is a ready-made action ("act"), or a template that asks for one value
// ("param"). trig: "press" for keys, buttons, dial presses and the wheel tap; "turn" for dials and the
// wheel's turn. Profiles and pages are added at run time (app.js), from the live config.
'use strict'
window.ACTION_LIBRARY = [
  { cat: 'Media', items: [
    { name: 'Play / pause', label: 'PLAY', color: 'sage', trig: 'press', act: { media: 'playpause' } },
    { name: 'Next track', label: 'NEXT', color: 'sage', trig: 'press', act: { media: 'next' } },
    { name: 'Previous track', label: 'PREV', color: 'sage', trig: 'press', act: { media: 'prev' } },
    { name: 'Stop', label: 'STOP', color: 'sage', trig: 'press', act: { media: 'stop' } },
    { name: 'Mute', label: 'MUTE', color: 'rose', trig: 'press', act: { media: 'mute' } },
    { name: 'Volume up', label: 'VOL +', color: 'sand', trig: 'press', act: { volume: 2 } },
    { name: 'Volume down', label: 'VOL -', color: 'sand', trig: 'press', act: { volume: -2 } },
    { name: 'Volume (turn)', label: 'VOLUME', color: 'sand', trig: 'turn', act: { volume: 1 } },
  ] },
  { cat: 'Edit', items: [
    { name: 'Copy', label: 'COPY', color: 'sky', trig: 'press', act: { keys: 'ctrl+c' } },
    { name: 'Cut', label: 'CUT', color: 'sky', trig: 'press', act: { keys: 'ctrl+x' } },
    { name: 'Paste', label: 'PASTE', color: 'sky', trig: 'press', act: { keys: 'ctrl+v' } },
    { name: 'Select all', label: 'ALL', color: 'sky', trig: 'press', act: { keys: 'ctrl+a' } },
    { name: 'Undo', label: 'UNDO', color: 'rose', trig: 'press', act: { keys: 'ctrl+z' } },
    { name: 'Redo', label: 'REDO', color: 'rose', trig: 'press', act: { keys: 'ctrl+y' } },
    { name: 'Save', label: 'SAVE', color: 'sage', trig: 'press', act: { keys: 'ctrl+s' } },
    { name: 'Find', label: 'FIND', color: 'sand', trig: 'press', act: { keys: 'ctrl+f' } },
    { name: 'Enter', label: 'ENTER', color: 'dust', trig: 'press', act: { keys: 'enter' } },
    { name: 'Escape', label: 'ESC', color: 'dust', trig: 'press', act: { keys: 'esc' } },
    { name: 'Scroll (turn)', label: 'SCROLL', color: 'sky', trig: 'turn', act: { scroll: -3 } },
    { name: 'Arrows left / right (turn)', label: 'ARROWS', color: 'sky', trig: 'turn', act: { keys: ['left', 'right'] } },
    { name: 'Arrows up / down (turn)', label: 'UP DOWN', color: 'sky', trig: 'turn', act: { keys: ['up', 'down'] } },
    { name: 'Zoom (turn)', label: 'ZOOM', color: 'sky', trig: 'turn', act: { keys: ['ctrl+-', 'ctrl+='] } },
  ] },
  { cat: 'Windows', items: [
    { name: 'Show desktop', label: 'DESKTOP', color: 'sand', trig: 'press', act: { keys: 'win+d' } },
    { name: 'Task view', label: 'TASKS', color: 'sand', trig: 'press', act: { keys: 'win+tab' } },
    { name: 'File Explorer', label: 'FILES', color: 'sand', trig: 'press', act: { keys: 'win+e' } },
    { name: 'Snap window left', label: 'SNAP L', color: 'sky', trig: 'press', act: { keys: 'win+left' } },
    { name: 'Snap window right', label: 'SNAP R', color: 'sky', trig: 'press', act: { keys: 'win+right' } },
    { name: 'Maximise window', label: 'MAXIMISE', color: 'sky', trig: 'press', act: { keys: 'win+up' } },
    { name: 'Minimise window', label: 'MINIMISE', color: 'sky', trig: 'press', act: { keys: 'win+down' } },
    { name: 'New tab', label: 'NEW TAB', color: 'dust', trig: 'press', act: { keys: 'ctrl+t' } },
    { name: 'Close tab', label: 'CLOSE TAB', color: 'dust', trig: 'press', act: { keys: 'ctrl+w' } },
    { name: 'Switch window (turn)', label: 'WINDOWS', color: 'sand', trig: 'turn', act: { keys: ['alt+shift+esc', 'alt+esc'] } },
  ] },
  // CT_RIG's verbs (host/schema.mjs TD_VERBS): the ones a TD rig profile is made of (docs/REMAP.md, the TD page layout)
  { cat: 'TouchDesigner', items: [
    ...[['rigKnob', 'PARAM', 'lilac'], ['rigReset', 'RESET', 'dust'], ['rigToggle', 'ON / OFF', 'sage'], ['rigPulse', 'FX RESET', 'dust']].map(([type, label, color]) => (
      { name: `${window.SCHEMA.TD_VERBS[type].name}…`, label, color, trig: window.SCHEMA.TD_VERBS[type].trig, act: { td: { type, par: '' } }, param: { kind: 'tdpar', ask: 'The CT_RIG parameter, like Glideamt' } })),
    { name: 'Play clip number…', label: 'CLIP', color: 'sage', trig: 'press', act: { td: { type: 'rigClip', n: 1 } }, param: { kind: 'number', ask: 'Clip number' } },
    { name: 'Next clip', label: 'CLIP +', color: 'bone', trig: 'press', act: { td: { type: 'rigClipStep', step: 1 } } },
    { name: 'Previous clip', label: 'CLIP -', color: 'bone', trig: 'press', act: { td: { type: 'rigClipStep', step: -1 } } },
    { name: 'Step clips (turn)', label: 'CLIP', color: 'bone', trig: 'turn', act: { td: { type: 'rigClipStep' } } },
    { name: 'Output window', label: 'VIEW', color: 'bone', trig: 'press', act: { td: { type: 'rigView' } } },
    { name: 'Record (REC)', label: 'REC', color: 'rose', trig: 'press', act: { td: { type: 'recordToggle' } } },
  ] },
  // Moshpit v3 (the Route B adapter): its commands as they are; params are best set by the moshpit rig spec
  // (config/rigs/moshpit.json), since a dial follows "slot n, param m" of whatever block is active
  { cat: 'Moshpit', items: [
    ...window.SCHEMA.MOSHPIT_COMMANDS.map((command) => ({ name: command.replace('.', ': ').replace(/([a-z])([A-Z])/g, '$1 $2'), label: command.split('.')[1].toUpperCase().slice(0, 10), color: 'peach', trig: 'press', act: { moshpit: { verb: 'command', command } } })),
    { name: 'Frames back / forward (turn)', label: 'FRAME', color: 'peach', trig: 'turn', act: { moshpit: { verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] } } },
    { name: 'Blocks back / forward (turn)', label: 'BLOCK', color: 'peach', trig: 'turn', act: { moshpit: { verb: 'step', commands: ['block.prev', 'block.next'] } } },
    { name: 'Move the selected node (turn)', label: 'NODE', color: 'peach', trig: 'turn', act: { moshpit: { verb: 'selstep' } } },
    ...[-1, 1].map(step => ({ name: `Select ${step < 0 ? 'previous' : 'next'} node`, label: `NODE ${step < 0 ? '-' : '+'}`, color: 'peach', trig: 'press', act: { moshpit: { verb: 'selstep', step } } })),
    { name: 'Parameter page: P1-6 / P7-8 / LFO', label: 'PARAM PAGE', color: 'peach', trig: 'press', act: { moshpit: { verb: 'bank', width: 6 } } },
    ...[1, 2, 3, 4, 5, 6].map(bank => ({ name: `Selected node, six-dial page control ${bank} (turn)`, label: `PARAM ${bank}`, color: 'peach', trig: 'turn', act: { moshpit: { verb: 'knob', slot: 'sel', bank, bankWidth: 6 } } })),
    { name: 'Bank: P1-3 / P4-6 / LFO (turn)', label: 'BANK', color: 'peach', trig: 'turn', act: { moshpit: { verb: 'bank' } } },
    ...[1, 2, 3].map((bank) => ({ name: `Selected node, bank ${bank} (turn)`, label: `EDIT ${bank}`, color: 'peach', trig: 'turn', act: { moshpit: { verb: 'knob', slot: 'sel', bank } } })),
    ...[1, 2, 3].map((param) => ({ name: `Slot 1, param ${param} (turn)`, label: `P${param}`, color: 'peach', trig: 'turn', act: { moshpit: { verb: 'knob', slot: 1, param } } })),
  ] },
  { cat: 'Custom', items: [
    { name: 'Keyboard shortcut…', label: 'KEYS', color: 'bone', trig: 'press', act: { keys: '' }, param: { kind: 'combo', ask: 'Press the shortcut' } },
    { name: 'Shortcut pair (turn)…', label: 'KEYS', color: 'bone', trig: 'turn', act: { keys: ['', ''] }, param: { kind: 'combo2', ask: 'Left turn, then right turn' } },
    { name: 'Type text…', label: 'TYPE', color: 'bone', trig: 'press', act: { type: '' }, param: { kind: 'text', ask: 'The text to type' } },
    { name: 'Launch a program…', label: 'LAUNCH', color: 'sand', trig: 'press', act: { launch: '' }, param: { kind: 'path', ask: 'Full path of the program (.exe)' } },
    { name: 'Bring an app forward…', label: 'FOCUS', color: 'sand', trig: 'press', act: { focus: '' }, param: { kind: 'exe', ask: 'Program file name, like Resolve.exe' } },
    { name: 'Back to MAIN', label: 'MAIN', color: 'bone', trig: 'press', act: { main: true } },
    { name: 'Nothing', label: '', color: 'dust', trig: 'any', act: { none: true } },
  ] },
]
// Presentation metadata stays keyed to payload identity, never a translated/display name.
const commandMeta = {
  'transport.play':['Play','play','Transport'], 'transport.stop':['Pause','pause','Transport'], 'transport.loop':['Play / pause','play','Transport'],
  'transport.playPause':['Play / pause','play','Transport'], 'transport.prevFrame':['Previous frame','back','Transport'], 'transport.nextFrame':['Next frame','forward','Transport'],
  'mark.in':['Mark In','mark-in','Browse'], 'mark.out':['Mark Out','mark-out','Browse'],
  'mark.in.nudgeBack':['Move In back','mark-in','Browse'], 'mark.in.nudgeForward':['Move In forward','mark-in','Browse'],
  'mark.out.nudgeBack':['Move Out back','mark-out','Browse'], 'mark.out.nudgeForward':['Move Out forward','mark-out','Browse'],
  'mark.range.nudgeBack':['Transpose back','clip','Browse'], 'mark.range.nudgeForward':['Transpose forward','clip','Browse'],
  'source.sendA':['Send to A','import','Browse'], 'source.sendB':['Send to B','import','Browse'],
  'source.addBlock':['Add block','add','Browse'], 'source.selectAll':['Select full clip','clip','Browse'],
  'source.zoomIn':['Zoom in','zoom','Browse'], 'source.zoomOut':['Zoom out','zoom','Browse'], 'source.zoomFit':['Fit clip','zoom','Browse'],
  'folder.prev':['Previous folder','folder','Browse'], 'folder.next':['Next folder','folder','Browse'],
  'block.prev':['Previous block','back','Effects'], 'block.next':['Next block','forward','Effects'],
  'block.freeze':['Freeze block','freeze','Effects'], 'block.unfreeze':['Thaw block','reset','Effects'],
  'edit.undo':['Undo edit','undo','Effects'], 'edit.redo':['Redo edit','redo','Effects'],
  'render.start':['Start render','render','Output'], 'workspace.node':['Open node editor','node','Workspaces'], 'workspace.settings':['Open settings','settings','Workspaces'],
  'clip.prev':['Previous clip','back','Browse'], 'clip.next':['Next clip','forward','Browse'],
  'workspace.browse':['Open IN','source','Workspaces'], 'workspace.mosh':['Open MOSH','mosh','Workspaces'], 'workspace.render':['Open OUT','render','Workspaces'],
}
function decorateAction(item, cat) {
  const a=item.act, command=a.moshpit?.command, meta=commandMeta[command]
  const app=a.moshpit ? 'moshpit' : a.td ? 'touchdesigner' : a.main || a.page || a.app || a.switch ? 'navigation' : 'system'
  let category = app === 'moshpit' ? (/^workspace\./.test(command || '') ? 'Workspaces' : /^transport\./.test(command || '') ? 'Transport' : /^(mark|clip|send|folder|range|zoom)\./.test(command || '') ? 'Browse' : /^(render|preview)\./.test(command || '') ? 'Output' : 'Effects') : app === 'touchdesigner' ? /Clip/.test(a.td.type) ? 'Browse' : /record|View/.test(a.td.type) ? 'Output' : 'Effects' : cat === 'Media' ? 'Audio' : cat === 'Windows' ? 'Desktop' : cat === 'Custom' ? 'Custom' : 'Shortcuts'
  const media={playpause:'play',next:'forward',prev:'back',stop:'stop',mute:'mute'}
  const keys={'ctrl+c':'layers','ctrl+x':'slice','ctrl+v':'import','ctrl+z':'undo','ctrl+y':'redo','ctrl+s':'save','ctrl+f':'view','win+d':'desktop','win+tab':'tasks','win+e':'folder'}
  const icon=meta?.[1] || (a.media ? media[a.media] : a.volume ? 'volume' : a.scroll ? 'scroll' : a.main ? 'home' : a.keys ? keys[a.keys] || 'keyboard' : a.moshpit ? category === 'Output' ? 'render' : category === 'Browse' ? 'clip' : 'effect' : a.td ? category === 'Browse' ? 'clip' : category === 'Output' ? 'view' : 'effect' : 'more')
  return {...item, id:window.EditorModel.actionIdentity(a,app), app, category:meta?.[2] || category, icon, name:meta?.[0] || item.name, label:meta?.[0] ? meta[0].toUpperCase().slice(0,10) : item.label}
}
window.ACTION_LIBRARY = window.ACTION_LIBRARY.map(group=>({...group, items:group.items.map(item=>decorateAction(item,group.cat))}))
