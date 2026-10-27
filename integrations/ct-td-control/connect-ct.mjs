// Find and connect a Loupedeck CT by USB hardware ID, on whatever COM port it landed.
// Reusable: import { findCT, connectCT } from './connect-ct.mjs'
import { SerialPort } from 'serialport'
import { LoupedeckCT } from 'loupedeck'

export const CT_VID = '2ec2'
export const CT_PID = '0003'

// Returns the port path (e.g. 'COM4'), or null if no CT is plugged in.
export async function findCT() {
  const ports = await SerialPort.list()
  const hit = ports.find(p => (p.vendorId || '').toLowerCase() === CT_VID && (p.productId || '').toLowerCase() === CT_PID)
  return hit ? hit.path : null
}

// Returns a connected LoupedeckCT. Throws a readable error if none is found.
// A deck whose last session ended without a close (a crash, a killed process)
// can leave the handshake hanging forever: measured on 27 Sep, every other
// launch after a killed run. So the handshake gets a deadline; the caller
// retries, and the retry goes through.
export const HANDSHAKE_MS = 4000

const HANDSHAKE = 'GET /index.html\nHTTP/1.1\nConnection: Upgrade\nUpgrade: websocket\nSec-WebSocket-Key: 123abc\n\n'
const FRAME_MAX = 256 * 1024

/**
 * Why the handshake hangs: a process killed halfway through a framebuffer
 * write (the centre screen is ~194KB) leaves the deck waiting for the rest
 * of that frame, so it eats the next handshake as pixels. Feeding it zeros
 * until the frame completes brings it back — measured 27 Sep: no reply at
 * 64KB and 128KB, "HTTP/1.1 101 Switching Protocols" at 192KB. Ends with a
 * websocket close so the next open starts clean. Returns true if the deck
 * answered.
 */
export async function unstickCT(path) {
  const port = new SerialPort({ path, baudRate: 256000 })
  await new Promise((res, rej) => { port.once('open', res); port.once('error', rej) })
  let reply = ''
  port.on('data', (d) => { reply += d.toString('latin1') })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  let ok = false
  try {
    for (let sent = 0; sent <= FRAME_MAX && !ok; sent += 64 * 1024) {
      if (sent) {
        port.write(Buffer.alloc(64 * 1024))
        await new Promise((r) => port.drain(r))
        await wait(300)
      }
      reply = ''
      port.write(Buffer.from(HANDSHAKE))
      await wait(1200)
      ok = reply.startsWith('HTTP/1.1')
    }
    port.write(Buffer.from([0x88, 0x80, 0, 0, 0, 0]))
    await wait(200)
  } finally {
    await new Promise((r) => port.close(() => r()))
  }
  return ok
}

export async function connectCT(opts = {}) {
  try {
    return await openCT(opts)
  } catch (e) {
    if (!/no handshake/.test(e.message)) throw e
    const path = await findCT()
    if (!path || !(await unstickCT(path))) throw e
    return openCT(opts)
  }
}

async function openCT({ timeoutMs = HANDSHAKE_MS, ...opts } = {}) {
  const path = await findCT()
  if (!path) throw new Error(`No Loupedeck CT found (USB VID ${CT_VID} / PID ${CT_PID}). Is it plugged in?`)
  const dev = new LoupedeckCT({ path, autoConnect: false, reconnectInterval: false, ...opts })
  let timer
  try {
    await Promise.race([
      dev.connect(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no handshake in ${timeoutMs}ms`)), timeoutMs) }),
    ])
  } catch (e) {
    await Promise.resolve(dev.close()).catch(() => {})
    throw new Error(`Loupedeck CT is on ${path} but could not be opened (${e.message}). Quit the Loupedeck app if it is running.`)
  } finally {
    clearTimeout(timer)
  }
  return dev
}

// Self-check: `node connect-ct.mjs` prints which port it picked.
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const dev = await connectCT().catch(e => { console.error(e.message); process.exit(1) })
  console.log('CT found on', dev.path, JSON.stringify(await dev.getInfo()))
  await dev.close()
  process.exit(0)
}
