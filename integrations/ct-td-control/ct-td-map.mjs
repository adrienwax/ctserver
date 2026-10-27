// CT -> TD map: turns a CT input event into the Python script the TD bridge should run.
// Data-driven; edit the tables here to retune. See CT-TD-MAPPING.md for the human-readable map.
//
// The design reuses TD's existing X1 handler: for most controls we emit the SAME
// handle(side, ctl, shift, v, press, xval, step) call the X1 MIDI path makes (map_test.py:32),
// so route()/lights()/state() behave identically. Absolute faders write state directly, and the
// layout step calls x1modes. CC numbers are the X1's own (see CT-TD-MAPPING.md §1).

// ---- ordered lists, from map_test.py (calm -> wild) ----
export const GEN_ORDER = ['web', 'spectrum', 'inbetween', 'reaction', 'neon', 'reeflight',
  'physarum', 'particles', 'deepreef', 'shore', 'plankton']
export const FX_ORDER = ['haze', 'pixsort', 'silhouette', 'reveal', 'timeslice', 'dreamfb',
  'swirl', 'timeblock', 'depthtime', 'paint', 'relight', 'mosh', 'marble', 'refract']

// X1 CC numbers per function (the X1's own numbers, as consumed by handle()).
export const CC = {
  drywet: 0, k1: 2, k2: 4, k3: 6, on: 8, freeze: 10, reset: 12,
  browse: 16, pulse: 20, loopPush: 24, loopTurn: 26, sync: 42,
}

// ---- python literal helpers ----
const py = v =>
  v === true ? 'True' :
  v === false ? 'False' :
  v === null || v === undefined ? 'None' :
  typeof v === 'number' ? String(v) :
  `'${String(v).replace(/'/g, "\\'")}'`

// Build a call to the TEST handler: handle(side, ctl, shift, v, press, xval, step)
function handle(mapModule, side, ctl, { shift = false, v = 0, press = false, xval = 0, step = 0 } = {}) {
  const args = [side, ctl, shift, v, press, xval, step].map(py).join(', ')
  return `mod('${mapModule}').handle(${args})`
}

// ---- semantic actions -> script -------------------------------------------------
// Each returns a python string, or null if guarded/unsupported.
export function buildScript(action, paths, scaling, guards) {
  const { mapModule, common, x1modes } = paths
  const H = (side, ctl, o) => handle(mapModule, side, ctl, o)

  switch (action.type) {
    // ---- pickers (browse) ----
    case 'pickGenStep':  return H('R', CC.browse, { step: action.step })   // +1 / -1
    case 'pickFxStep':   return H('L', CC.browse, { step: action.step })
    // absolute pick by name (mirrors map_test.py: set_source + unpick for gen; T['fx']+route+unpick for fx)
    case 'pickGenName':
      return `_c=mod('${common}');_c.st().set_source(${py(action.name)});_c.x1().unpick('R')`
    case 'pickFxName':
      return `_c=mod('${common}');_m=mod('${mapModule}');_m.T['fx']=${py(action.name)};_m.route();_c.x1().unpick('L')`

    // ---- generator knobs / speed / freeze / reset (right hand) ----
    // CT dials are endless encoders, so they nudge the stored value directly. handle()'s knob path
    // has X1 pickup (writes only once an absolute knob crosses the stored value), which a relative
    // encoder starting nowhere in particular would rarely satisfy. Measured 27 Sep: no change in TD.
    case 'genKnob':      return knobNudgeScript(common, mapModule, 'R', action.n, action.delta)
    // per-knob reset: write just this knob back to its rest value (a CT extra; X1 only had side reset)
    case 'genKnobReset': return knobResetScript(common, mapModule, 'R', action.n)
    case 'genSpeedStep': return H('R', CC.loopTurn, { step: action.step })
    case 'genSpeedReset':return H('R', CC.loopPush, { press: true })
    // freeze and pulse write the state map_test.py (26 Sep) writes for ctl 10 / 20, directly, because
    // the TEST DAT in RAWK_ShowRig-v2.1 (24 Sep) has no branch for either. Measured 27 Sep: no change.
    case 'freeze':       return `_S=mod('${common}').st().S;_S['frozen'] ^= {_S['source']}`
    case 'resetGen':     return H('R', CC.reset, { press: true })

    // ---- effect knobs / on / pulse / speed / reset (left hand) ----
    case 'fxKnob':       return knobNudgeScript(common, mapModule, 'L', action.n, action.delta)
    case 'fxKnobReset':  return knobResetScript(common, mapModule, 'L', action.n)
    case 'fxOn':         return H('L', CC.on, { press: true })      // toggle
    case 'pulse':        return `_S=mod('${common}').st().S;_f=mod('${mapModule}').T['fx'];_S['pulse'][_f]=not _S['pulse'][_f]`
    case 'resetFx':      return H('L', CC.reset, { press: true })
    // effect speed as an ABSOLUTE fader (touchstrip) -> direct state write.
    case 'fxSpeedAbs': {
      const val = logRange(clamp01(action.frac), scaling.fxSpeedMin, scaling.fxSpeedMax)
      // direct state write: set the current effect's rate to an absolute value
      return `_f=mod('${mapModule}').T['fx'];mod('${common}').st().S['rate'][_f]=${round3(val)}`
    }
    case 'fxSpeedReset': return H('L', CC.loopPush, { press: true })

    // ---- global ----
    // master level: shared() reads it from xval (MASK['level'] = xval), not v
    case 'level':        return H('L', CC.drywet, { xval: round3(clamp01(action.frac)) })
    case 'tap':          return H('L', CC.sync, { press: true, v: scaling.levelVMax })
    case 'layoutStep':
      if (!guards.allowLayout) return null   // guarded: moves the rig out of TEST
      return `mod('${x1modes}').step(${py(action.side || 'R')})`

    // ---- record the live output (/project1/OUT) to a versioned movie file ----
    // Toggles /project1/REC (Movie File Out). REC_ctrl.toggle() picks a fresh timestamped
    // filename in the configured recording directory on each start, so nothing is overwritten.
    case 'recordToggle': return `mod('/project1/REC_ctrl').toggle()`

    // ---- --neon-look (temporary, 27 Sep): left dials shape the rack look, not the TEST effect ----
    case 'lookKnob': {
      const [key, i] = LOOK[action.n - 1]
      return `_S=mod('${common}').st().S;_S[${py(key)}][${py(i)}]=min(1.0,max(0.0,_S[${py(key)}][${py(i)}]+(${round3(action.delta)})))`
    }
    case 'lookReset': {
      const [key, i, rest] = LOOK[action.n - 1]
      return `mod('${common}').st().S[${py(key)}][${py(i)}]=${rest}`
    }

    // ---- CT_RIG (td/build_ct_rig.py, 1 Oct): the lean rig, one CT page per part of the chain ----
    // A dial nudges a parameter by `delta` (clicks x knobStep) of its own range, clamped; press resets.
    // Quantize each integer detent before multiplying the raw count. Queue coalescing
    // must not turn nine fine detents into one minimum step. Legacy direct callers
    // without raw counts keep their single-delta behaviour; floats stay normalized.
    case 'rigKnob': {
      const detents = Number.isSafeInteger(action.detents) ? action.detents : 1
      const perDetent = Number.isFinite(action.detentStep) ? action.detentStep : action.delta
      return `_p=op('${RIG}').par.${parName(action.par)};_d=(${round3(perDetent)})*(_p.normMax-_p.normMin);_d=(((1 if _d>0 else -1)*max(1,int(abs(_d)+0.5)) if _d else 0)*(${detents})) if _p.style=='Int' else (${round3(action.delta)})*(_p.normMax-_p.normMin);_p.val=min(_p.normMax,max(_p.normMin,_p.eval()+_d))`
    }
    case 'rigFrameStep': return `_r=op('${RIG}');_n=int(_r.par.Framecount.eval());assert _n>1, 'Source frames unavailable';_p=_r.par.Position;_p.val=min(1.0,max(0.0,_p.eval()+(${Math.trunc(action.step)||0})/(_n-1)))`
    case 'rigReset':  return `_p=op('${RIG}').par.${parName(action.par)};_p.val=_p.default`
    case 'rigToggle': return `_p=op('${RIG}').par.${parName(action.par)};_p.val=not _p.eval()`
    // a momentary press (FX RESET): CT_RIG's pulse parameter fires once; nothing stays lit on the CT
    case 'rigPulse':  return `op('${RIG}').par.${parName(action.par)}.pulse()`
    case 'rigClip':   return `_r=op('${RIG}');_r.par.Clip=${Math.round(action.n)};_r.op('movie').par.cuepulse.pulse()`
    case 'rigClipStep': return `_p=op('${RIG}').par.Clip;_p.val=(int(_p.eval())-1+(${Math.trunc(action.step) || 1}))%int(_p.normMax)+1;op('${RIG}').op('movie').par.cuepulse.pulse()`
    // the output window: open and close it, so the rig cooks only while it is being watched
    case 'rigView':   return `_r=op('${RIG}');_v=not _r.par.View.eval();_r.par.View=_v;(_r.op('window').par.winopen if _v else _r.op('window').par.winclose).pulse()`

    default: return null
  }
}

// CT_RIG lives here; its parameter names are single words (Speed, Trailamt), checked before use.
export const RIG = '/project1/CT_RIG'
const parName = n => { if (!/^[A-Z][a-z0-9]+$/.test(String(n))) throw new Error(`not a CT_RIG parameter name: ${n}`); return n }
// The deck reads this to light keys and draw dial bars: the clip, the toggles, every parameter 0-1.
export const RIG_STATE_PY = `_r=op('${RIG}')
result=None if _r is None else {'clip':int(_r.par.Clip.eval()) if hasattr(_r.par,'Clip') else 0,'on':{p.name:bool(p.eval()) for p in _r.customPars if p.style=='Toggle'},'norm':{p.name:(p.eval()-p.normMin)/((p.normMax-p.normMin) or 1) for p in _r.customPars if p.style in ('Float','Int')},'values':{p.name:p.eval() for p in _r.customPars if p.style in ('Float','Int','Toggle','Str')},'types':{p.name:p.style for p in _r.customPars},'ranges':{p.name:{'min':p.normMin,'max':p.normMax,'default':p.default,'scale':'linear'} for p in _r.customPars if p.style in ('Float','Int')}}`

// --neon-look: the three left dials. [state key, field, value at the 26 Sep capture]
export const LOOK = [['rack', 'mix', 1.0], ['cap', 'top', 0.42], ['cap', 'knee', 0.28]]
export const LOOK_PY = common => `_S=mod('${common}').st().S;result=[_S['rack']['mix'],_S['cap']['top'],_S['cap']['knee']]`

// Reset a single knob (n=1..3) to its rest value. m is the generator (source) on R, the fx on L.
function knobResetScript(common, mapModule, side, n) {
  const idx = n - 1
  const mExpr = side === 'R' ? `_s.S['source']` : `mod('${mapModule}').T['fx']`
  return `_s=mod('${common}').st();_m=${mExpr};_s.S['k'][_m][${idx}]=_s.rest(_m)[${idx}]`
}

// Nudge knob n (1..3) by delta, clamped to 0..1. m is the generator on R, the fx on L.
function knobNudgeScript(common, mapModule, side, n, delta) {
  const mExpr = side === 'R' ? `_s.S['source']` : `mod('${mapModule}').T['fx']`
  return `_s=mod('${common}').st();_k=_s.S['k'][${mExpr}];_k[${n - 1}]=min(1.0,max(0.0,_k[${n - 1}]+(${round3(delta)})))`
}

function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)) }
function round3(x) { return Math.round(x * 1000) / 1000 }
// log-map a 0..1 fraction onto [min,max]
function logRange(frac, min, max) {
  const lo = Math.log(min), hi = Math.log(max)
  return Math.exp(lo + (hi - lo) * frac)
}
