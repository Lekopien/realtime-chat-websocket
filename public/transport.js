// Two interchangeable transports that speak the same protocol as src/chat.js.

/** Real server connection over WebSocket. */
export class SocketTransport {
  constructor(url) { this.url = url; }
  connect(onMessage) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      const timer = setTimeout(() => { this.ws.close(); reject(new Error("timeout")); }, 2500);
      this.ws.onopen = () => { clearTimeout(timer); this.open = true; resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error("unreachable")); };
      this.ws.onmessage = (e) => onMessage(JSON.parse(e.data));
      this.ws.onclose = () => this.open && onMessage({ type: "error", error: "disconnected from server" });
    });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
}

/**
 * Serverless demo: tabs of the same browser talk through BroadcastChannel and
 * share history through localStorage. Used on the static showcase site.
 */
export class LocalTransport {
  connect(onMessage) {
    this.emit = onMessage;
    this.peers = new Map();
    return Promise.resolve();
  }
  send(msg) {
    if (msg.type === "join") return this.join(msg);
    if (msg.type === "typing") return this.ch.postMessage({ type: "typing", name: this.name });
    if (msg.type === "message") {
      const text = String(msg.text).trim().slice(0, 500);
      if (!text) return;
      const out = { type: "message", id: crypto.randomUUID(), name: this.name, text, at: Date.now() };
      const history = [...this.history(), out].slice(-50);
      try { localStorage.setItem(this.key, JSON.stringify(history)); } catch { /* ignore */ }
      this.ch.postMessage(out);
      this.emit(out);
    }
  }
  history() {
    try { return JSON.parse(localStorage.getItem(this.key)) ?? []; } catch { return []; }
  }
  users() { return [this.name, ...this.peers.keys()].sort(); }
  join({ name, room }) {
    this.name = name;
    this.key = `chat-demo:${room}`;
    this.ch = new BroadcastChannel(this.key);
    this.ch.onmessage = ({ data }) => {
      if (data.type === "hello" || data.type === "here") {
        const isNew = !this.peers.has(data.name);
        this.peers.set(data.name, Date.now());
        if (data.type === "hello") this.ch.postMessage({ type: "here", name: this.name });
        if (isNew) this.emit({ type: "joined", name: data.name, users: this.users() });
      } else if (data.type === "bye") {
        this.peers.delete(data.name);
        this.emit({ type: "left", name: data.name, users: this.users() });
      } else {
        this.emit(data);
      }
    };
    addEventListener("pagehide", () => this.ch.postMessage({ type: "bye", name: this.name }));
    this.emit({ type: "welcome", room, history: this.history(), users: this.users() });
    this.ch.postMessage({ type: "hello", name });
  }
}
