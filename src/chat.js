import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const HISTORY = 50;
const MAX_LEN = 500;
const NAME_RE = /^[\p{L}\p{N} _.-]{2,20}$/u;
const ROOM_RE = /^[a-z0-9-]{1,24}$/;

/** Serves public/ as static files; anything else 404s. */
function serveStatic(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, path.endsWith("/") ? "index.html" : path);
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  const stream = createReadStream(file);
  stream.on("open", () => { res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }); stream.pipe(res); });
  stream.on("error", () => res.writeHead(404).end("not found"));
}

/**
 * Creates the chat server. Protocol (JSON over one WebSocket):
 *   client → server: join {name, room} | message {text} | typing {}
 *   server → client: welcome {history, users} | message | joined | left | typing | error
 */
export function createChatServer({ rateLimit = { max: 5, perMs: 3000 }, heartbeatMs = 30_000 } = {}) {
  const http = createServer((req, res) => (req.url === "/health" ? res.end("ok") : serveStatic(req, res)));
  const wss = new WebSocketServer({ server: http, maxPayload: 4096 });
  const rooms = new Map(); // room -> { clients: Set<ws>, history: [] }

  const room = (name) => {
    if (!rooms.has(name)) rooms.set(name, { clients: new Set(), history: [] });
    return rooms.get(name);
  };
  const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const broadcast = (name, msg, except) => {
    for (const c of room(name).clients) if (c !== except) send(c, msg);
  };
  const users = (name) => [...room(name).clients].map((c) => c.user.name).sort();

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.sent = [];
    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return send(ws, { type: "error", error: "invalid JSON" }); }

      if (msg.type === "join") {
        const name = String(msg.name ?? "").trim();
        const roomName = String(msg.room ?? "lobby").toLowerCase();
        if (ws.user) return send(ws, { type: "error", error: "already joined" });
        if (!NAME_RE.test(name)) return send(ws, { type: "error", error: "name must be 2-20 letters, numbers, spaces or . _ -" });
        if (!ROOM_RE.test(roomName)) return send(ws, { type: "error", error: "room must be 1-24 lowercase letters, numbers or -" });
        if (users(roomName).includes(name)) return send(ws, { type: "error", error: "name taken in this room" });
        ws.user = { name, room: roomName };
        room(roomName).clients.add(ws);
        send(ws, { type: "welcome", room: roomName, history: room(roomName).history, users: users(roomName) });
        broadcast(roomName, { type: "joined", name, users: users(roomName) }, ws);
        return;
      }

      if (!ws.user) return send(ws, { type: "error", error: "join first" });

      if (msg.type === "typing") return broadcast(ws.user.room, { type: "typing", name: ws.user.name }, ws);

      if (msg.type === "message") {
        const text = String(msg.text ?? "").trim().slice(0, MAX_LEN);
        if (!text) return;
        const now = Date.now();
        ws.sent = ws.sent.filter((t) => now - t < rateLimit.perMs);
        if (ws.sent.length >= rateLimit.max) return send(ws, { type: "error", error: "slow down" });
        ws.sent.push(now);
        const out = { type: "message", id: `${now}-${Math.random().toString(36).slice(2, 7)}`, name: ws.user.name, text, at: now };
        const r = room(ws.user.room);
        r.history.push(out);
        if (r.history.length > HISTORY) r.history.shift();
        broadcast(ws.user.room, out);
        return;
      }

      send(ws, { type: "error", error: `unknown type ${msg.type}` });
    });

    ws.on("close", () => {
      if (!ws.user) return;
      const { name, room: roomName } = ws.user;
      const r = room(roomName);
      r.clients.delete(ws);
      broadcast(roomName, { type: "left", name, users: users(roomName) });
      if (!r.clients.size && !r.history.length) rooms.delete(roomName);
    });
  });

  // Drop connections that stop answering pings (closed laptops, dead networks).
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  wss.on("close", () => clearInterval(timer));
  http.on("close", () => wss.close());

  return { http, wss, rooms };
}
