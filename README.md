# Realtime Chat (WebSockets)

[![ci](https://github.com/Lekopien/realtime-chat-websocket/actions/workflows/ci.yml/badge.svg)](https://github.com/Lekopien/realtime-chat-websocket/actions/workflows/ci.yml)

**Live demo: https://chat.lekopien.com** (open it in two tabs)

A multi-room, real-time chat built on **Node.js and WebSockets** (`ws`). One small server handles rooms, presence, typing indicators, message history, rate limiting and dead-connection detection, and also serves the vanilla-JS client.

## Features

- **Rooms**: join any room by name; messages never leak between rooms.
- **Presence**: live "online" list with join and leave announcements.
- **Typing indicators**, throttled on the client so they don't flood the socket.
- **History**: the last 50 messages of a room are sent to newcomers.
- **Abuse protection**: per-connection rate limit, 4 KB frame cap, 500-character messages, validated names and rooms, unique names per room.
- **Heartbeats**: ping/pong every 30 s drops connections that silently died.
- **XSS-safe client**: messages are rendered with `textContent`, never `innerHTML`.
- **Serverless demo mode**: on the static showcase site the client swaps the WebSocket for a `BroadcastChannel` transport, so tabs of the same browser can chat with no backend.

## Run it

```bash
npm install
npm start          # http://localhost:8080, open two tabs
npm test           # integration tests with real sockets
```

## Protocol

JSON messages over a single WebSocket:

| Direction | Type | Payload |
| --- | --- | --- |
| client → server | `join` | `{ name, room }` |
| client → server | `message` | `{ text }` |
| client → server | `typing` | `{}` |
| server → client | `welcome` | `{ room, history, users }` |
| server → client | `message` | `{ id, name, text, at }` |
| server → client | `joined` / `left` | `{ name, users }` |
| server → client | `typing` | `{ name }` |
| server → client | `error` | `{ error }` |

## Layout

```
src/chat.js         WebSocket server, rooms, protocol, static file server
src/server.js       entry point
public/app.js       UI logic
public/transport.js SocketTransport (real server) and LocalTransport (demo mode)
test/chat.test.js   integration tests: broadcast, rooms, typing, validation, rate limit, leave
```

## Deploy

- **Full app (server):** `docker build -t chat . && docker run -p 8080:8080 chat`, or any Node host.
- **Showcase (free):** `public/` is served by a Cloudflare Worker at `chat.lekopien.com` (see `wrangler.jsonc`), running in demo mode.

## License

MIT

## Author

Built by **David Lekopien** ([@Lekopien](https://github.com/Lekopien)) · [lekopien.com](https://lekopien.com)
