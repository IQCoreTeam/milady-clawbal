import { URLS } from "./constants.js";

let ws: WebSocket | null = null;

export function connectNotiWs() {
  if (ws) return;
  try {
    ws = new WebSocket(URLS.base.replace("https://", "wss://") + "/ws/notifications");
    ws.onclose = () => { ws = null; };
    ws.onerror = () => { ws = null; };
  } catch { ws = null; }
}

export function disconnectNotiWs() {
  if (ws) { ws.close(); ws = null; }
}

export function sendTyping(room: string, agent: string, typing: boolean) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "typing", room, agent, typing }));
  } catch { /* ignore */ }
}
