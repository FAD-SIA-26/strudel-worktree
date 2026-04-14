const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000'

type Handler = (event: unknown) => void

class OrcWS {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private timer: ReturnType<typeof setTimeout> | null = null

  connect(): void {
    if (typeof window === 'undefined') return
    try {
      this.ws = new WebSocket(WS_URL)
      this.ws.onmessage = e => { try { this.handlers.forEach(h => h(JSON.parse(e.data))) } catch {} }
      this.ws.onclose   = () => { this.timer = setTimeout(() => this.connect(), 2000) }
      this.ws.onerror   = () => this.ws?.close()
    } catch { this.timer = setTimeout(() => this.connect(), 2000) }
  }

  subscribe(h: Handler): () => void { this.handlers.add(h); return () => this.handlers.delete(h) }

  disconnect(): void {
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }
}

export const orcWs = new OrcWS()
