import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { eventBus } from '../events/eventBus'
import type { OrcEvent } from '@orc/types'

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws: WebSocket) => {
    const handler = (e: OrcEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e))
    }
    eventBus.on('event', handler)
    ws.on('close', () => eventBus.off('event', handler))
    ws.on('error', () => { eventBus.off('event', handler); ws.close() })
  })
  return wss
}
