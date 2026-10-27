// Tiny HTTP client for the TouchDesigner bridge (patched touchdesigner-mcp WebServer DAT).
// Loopback only. See record/briefs/_results/09-td-bridge.md and CT-TD-MAPPING.md §4.
//
// No third-party deps: uses Node's built-in fetch (Node 18+).

export function makeTdClient(cfg) {
  const { execUrl, handshakeUrl, stateUrl, timeoutMs = 1500 } = cfg

  async function post(url, body) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const json = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, json }
    } finally {
      clearTimeout(t)
    }
  }

  async function get(url) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      const json = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, json }
    } finally {
      clearTimeout(t)
    }
  }

  return {
    // Confirm the bridge is up and reaching TD.
    async handshake() {
      return get(handshakeUrl)
    },
    // Run one Python script inside TD. Returns { success, data, error } from the DAT.
    async exec(script) {
      const r = await post(execUrl, { script })
      return r.json
    },
    // Read the tutorial rig's live state (for CT screen/LED feedback).
    async state() {
      const r = await get(stateUrl)
      return r.json
    },
  }
}
