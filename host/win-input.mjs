// Windows input for the deck host: shortcuts, media keys, volume, scrolling, typing, bringing an app
// forward, and reading which app is in front. No native dependency: one resident PowerShell process
// calls user32 SendInput (measured 27 Sep: 11 ms median round trip after about 1 s to start).
//
// Key names are parsed here, in JS, so the config checker (profiles.mjs) rejects a bad key with the
// same table the host uses to press it.
import fs from 'node:fs'
import { spawn } from 'node:child_process'

// ---- key names -> virtual-key codes ----------------------------------------------------------------
const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b,
  enter: 0x0d, return: 0x0d, esc: 0x1b, escape: 0x1b, tab: 0x09, space: 0x20, backspace: 0x08,
  delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, printscreen: 0x2c, capslock: 0x14, menu: 0x5d,
  ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0, '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde,
}
for (let i = 0; i < 26; i++) VK[String.fromCharCode(97 + i)] = 0x41 + i
for (let i = 0; i < 10; i++) VK[String(i)] = 0x30 + i
for (let i = 1; i <= 24; i++) VK[`f${i}`] = 0x6f + i
for (let i = 0; i < 10; i++) VK[`numpad${i}`] = 0x60 + i   // the number pad, as Blender's view keys need
Object.assign(VK, { numpadmultiply: 0x6a, numpadadd: 0x6b, numpadsubtract: 0x6d, numpaddecimal: 0x6e, numpaddivide: 0x6f })
export const KEY_NAMES = Object.keys(VK)

export const MEDIA = { playpause: 0xb3, next: 0xb0, prev: 0xb1, previous: 0xb1, stop: 0xb2, mute: 0xad }
const VOL_UP = 0xaf, VOL_DOWN = 0xae

// "ctrl+shift+s" -> [0x11, 0x10, 0x53]; throws with a readable reason.
export function parseCombo(combo) {
  if (typeof combo !== 'string' || !combo.trim()) throw new Error('a shortcut must be text like "ctrl+c"')
  return combo.toLowerCase().split('+').map(k => k.trim()).map(k => {
    if (!(k in VK)) throw new Error(`"${k}" is not a key name (letters, digits, f1-f24, ctrl, shift, alt, win, enter, esc, tab, space, arrows, home, end, pageup, pagedown, delete...)`)
    return VK[k]
  })
}

// ---- the resident helper --------------------------------------------------------------------------
const CS = `
using System; using System.Runtime.InteropServices; using System.Diagnostics; using System.Text;
public static class WXIn {
  [StructLayout(LayoutKind.Sequential)] struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MI { public int dx; public int dy; public int data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct U { [FieldOffset(0)] public KI k; [FieldOffset(0)] public MI m; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  static INPUT Key(ushort vk, bool up, bool unicode) {
    var i = new INPUT(); i.type = 1; i.u.k.flags = (uint)((up ? 2 : 0) | (unicode ? 4 : 0));
    if (unicode) i.u.k.scan = vk; else i.u.k.vk = vk;
    if (!unicode && (vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || (vk >= 0x21 && vk <= 0x2e) || vk == 0x5b)) i.u.k.flags |= 1; // extended
    return i;
  }
  static string Send(INPUT[] a) { uint n = SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); return n == a.Length ? "ok" : "blocked"; }
  // Press in order, release in reverse: a shortcut never leaves a modifier down.
  public static string Keys(string csv) {
    var vks = Array.ConvertAll(csv.Split(','), s => Convert.ToUInt16(s));
    var a = new INPUT[vks.Length * 2];
    for (int i = 0; i < vks.Length; i++) { a[i] = Key(vks[i], false, false); a[a.Length - 1 - i] = Key(vks[i], true, false); }
    return Send(a);
  }
  public static string Tap(int vk, int times) { var a = new INPUT[times * 2]; for (int i = 0; i < times; i++) { a[i*2] = Key((ushort)vk, false, false); a[i*2+1] = Key((ushort)vk, true, false); } return Send(a); }
  public static string Type(string b64) {
    string t = Encoding.UTF8.GetString(Convert.FromBase64String(b64)); var a = new INPUT[t.Length * 2];
    for (int i = 0; i < t.Length; i++) { a[i*2] = Key(t[i], false, true); a[i*2+1] = Key(t[i], true, true); }
    return Send(a);
  }
  public static string Scroll(int lines) { var i = new INPUT(); i.type = 0; i.u.m.flags = 0x0800; i.u.m.data = lines * 120; return Send(new INPUT[] { i }); }
  public static string Release() { var a = new INPUT[4]; ushort[] m = { 0x11, 0x10, 0x12, 0x5b }; for (int i = 0; i < 4; i++) a[i] = Key(m[i], true, false); return Send(a); }
  public static string Front() {
    uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    try { return Process.GetProcessById((int)pid).ProcessName.ToLower(); } catch { return ""; }
  }
  // Bring the named app's main window forward. Windows refuses a background process that has not
  // had input; a tap of Alt first is the standard way round that.
  public static string Focus(string name) {
    foreach (var p in Process.GetProcessesByName(name)) {
      var h = p.MainWindowHandle; if (h == IntPtr.Zero) continue;
      if (IsIconic(h)) ShowWindow(h, 9);
      if (!SetForegroundWindow(h)) { Send(new INPUT[] { Key(0x12, false, false), Key(0x12, true, false) }); SetForegroundWindow(h); }
      return Front() == name.ToLower() ? "ok" : "refused";
    }
    return "notrunning";
  }
  public static string Running(string name) { foreach (var p in Process.GetProcessesByName(name)) if (p.MainWindowHandle != IntPtr.Zero) return "yes"; return "no"; }
}`

export function createWinInput({ dry = false, log = () => {} } = {}) {
  let ps = null, buf = '', queue = [], ready = null, spotifyLoaded = false
  const start = () => {
    ps = spawn('powershell', ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    buf = ''; spotifyLoaded=false
    ps.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (line.startsWith('@@')) { const q = queue.shift(); if (q) q(line.slice(2)) }
      }
    })
    ps.stderr.on('data', d => log(`input helper: ${String(d).trim().slice(0, 200)}`))
    ps.on('exit', code => { log(`input helper exited (${code}); restarting on next use`); ps = null; for (const q of queue.splice(0)) q('error') })
    // one line: in -Command - mode PowerShell runs stdin line by line, so a multi-line here-string never ends
    ps.stdin.write(`Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(CS).toString('base64')}')))\n`)
    ready = call('"ready"')
  }
  // one command per line; each answers one "@@<result>" line, in order
  function call(expr) {
    if (!ps) start()
    return new Promise(res => { queue.push(res); ps.stdin.write(`"@@" + (${expr})\n`) })
  }
  const run = async (expr, what) => {
    if (dry) { log(`DRY input: ${what}`); return 'ok' }
    if (!ps) start()
    await ready
    return call(expr)
  }
  return {
    spotify: async payload => {
      if(dry)return JSON.stringify({ok:false,error:'Spotify is unavailable in dry mode'})
      if(!ps)start();await ready
      if(!spotifyLoaded){
        const source=fs.readFileSync(new URL('./spotify-media.ps1',import.meta.url),'utf8')
        ps.stdin.write(". ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+Buffer.from(source).toString('base64')+"'))))\n")
        await call("'ready'")
        spotifyLoaded=true
      }
      return call("Invoke-WXSpotify '"+Buffer.from(JSON.stringify(payload)).toString('base64')+"'")
    },
    keys: combo => run(`[WXIn]::Keys('${parseCombo(combo).join(',')}')`, `keys ${combo}`),
    media: name => run(`[WXIn]::Tap(${MEDIA[name]}, 1)`, `media ${name}`),
    volume: steps => run(`[WXIn]::Tap(${steps > 0 ? VOL_UP : VOL_DOWN}, ${Math.min(20, Math.abs(Math.round(steps)))})`, `volume ${steps}`),
    scroll: lines => run(`[WXIn]::Scroll(${Math.round(lines)})`, `scroll ${lines}`),
    type: text => run(`[WXIn]::Type('${Buffer.from(String(text), 'utf8').toString('base64')}')`, `type ${text}`),
    release: () => run('[WXIn]::Release()', 'release modifiers'),
    // these read the system, so they run even when dry
    front: async () => { if (!ps) start(); await ready; return call('[WXIn]::Front()') },
    running: async exe => { if (!ps) start(); await ready; return (await call(`[WXIn]::Running('${exeName(exe)}')`)) === 'yes' },
    focus: exe => dry ? (log(`DRY input: focus ${exe}`), Promise.resolve('ok')) : (async () => { if (!ps) start(); await ready; return call(`[WXIn]::Focus('${exeName(exe)}')`) })(),
    close: () => { if (ps) { try { ps.stdin.end() } catch {} ps.kill(); ps = null } },
  }
}
// "EDENA.exe" -> "edena": Process.GetProcessesByName takes the name without .exe
export const exeName = exe => String(exe).replace(/\.exe$/i, '').replace(/'/g, '')

// Self-check: `node host/win-input.mjs` parses combos and presses F24 (a key nothing uses) once.
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const assert = (await import('node:assert')).strict
  assert.deepEqual(parseCombo('ctrl+shift+s'), [0x11, 0x10, 0x53])
  assert.deepEqual(parseCombo('Win+Tab'), [0x5b, 0x09])
  assert.throws(() => parseCombo('ctlr+c'), /"ctlr" is not a key name/)
  const w = createWinInput({ log: console.log })
  const t0 = Date.now()
  console.log('F24 press:', await w.keys('f24'), `(${Date.now() - t0} ms incl. start)`)
  const t1 = Date.now()
  console.log('front app:', await w.front(), `(${Date.now() - t1} ms)`)
  console.log('explorer running:', await w.running('explorer.exe'), '| nosuchapp running:', await w.running('nosuchapp.exe'))
  console.log('modifiers released:', await w.release())
  w.close()
  console.log('win-input self-check ok')
}
