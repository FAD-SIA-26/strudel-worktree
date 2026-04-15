import type { Server } from "node:http";
import type { OrcEvent } from "@orc/types";
import { WebSocket, WebSocketServer } from "ws";
import { eventBus } from "../events/eventBus";

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws: WebSocket) => {
    const handler = (e: OrcEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
    };
    eventBus.on("event", handler);
    ws.on("close", () => eventBus.off("event", handler));
    ws.on("error", () => {
      eventBus.off("event", handler);
      ws.close();
    });
  });
  return wss;
}
