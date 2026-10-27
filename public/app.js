import { LocalTransport, SocketTransport } from "./transport.js";

const $ = (id) => document.getElementById(id);
let transport, me, typingTimer, lastTyping = 0;
const typers = new Map();

async function connect() {
  const isLocalServer = !location.hostname.endsWith("lekopien.com");
  if (isLocalServer) {
    const socket = new SocketTransport(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
    try {
      await socket.connect(handle);
      $("mode").textContent = "connected to server";
      return socket;
    } catch { /* fall through to demo mode */ }
  }
  const local = new LocalTransport();
  await local.connect(handle);
  $("mode").textContent = "demo mode: open in two tabs";
  return local;
}

function item(cls, ...children) {
  const li = document.createElement("li");
  li.className = cls;
  li.append(...children);
  $("log").append(li);
  $("log").scrollTop = $("log").scrollHeight;
}

function span(cls, text) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text; // textContent, never innerHTML: messages can't inject markup
  return s;
}

function showMessage(m) {
  const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  item(`msg${m.name === me ? " me" : ""}`, span("who", `${m.name} · ${time}`), document.createElement("br"), span("bubble", m.text));
}

function showUsers(users) {
  $("users").replaceChildren(...users.map((u) => Object.assign(document.createElement("li"), { textContent: u === me ? `${u} (you)` : u })));
}

function renderTyping() {
  const names = [...typers.keys()];
  $("typing").textContent = names.length ? `${names.join(", ")} ${names.length > 1 ? "are" : "is"} typing…` : "";
}

function handle(m) {
  switch (m.type) {
    case "welcome":
      $("join").hidden = true;
      $("chat").hidden = false;
      $("roomTitle").textContent = `#${m.room}`;
      m.history.forEach(showMessage);
      item("sys", `You joined #${m.room}`);
      showUsers(m.users);
      $("text").focus();
      break;
    case "message":
      typers.delete(m.name);
      renderTyping();
      showMessage(m);
      break;
    case "joined": item("sys", `${m.name} joined`); showUsers(m.users); break;
    case "left": item("sys", `${m.name} left`); showUsers(m.users); break;
    case "typing":
      clearTimeout(typers.get(m.name));
      typers.set(m.name, setTimeout(() => { typers.delete(m.name); renderTyping(); }, 2500));
      renderTyping();
      break;
    case "error":
      if (!$("join").hidden) $("joinError").textContent = m.error;
      else item("sys", `⚠ ${m.error}`);
      break;
  }
}

$("join").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("joinError").textContent = "";
  me = $("name").value.trim();
  transport ??= await connect();
  transport.send({ type: "join", name: me, room: $("room").value.trim().toLowerCase() });
});

$("say").addEventListener("submit", (e) => {
  e.preventDefault();
  transport.send({ type: "message", text: $("text").value });
  $("text").value = "";
});

$("text").addEventListener("input", () => {
  if (Date.now() - lastTyping > 1500) {
    lastTyping = Date.now();
    transport.send({ type: "typing" });
  }
  clearTimeout(typingTimer);
});
