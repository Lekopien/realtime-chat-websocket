import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { createChatServer } from "../src/chat.js";

let server, url;
before(async () => {
  server = createChatServer({ rateLimit: { max: 3, perMs: 10_000 } });
  await new Promise((r) => server.http.listen(0, r));
  url = `ws://localhost:${server.http.address().port}`;
});
after(() => server.http.close());

/** Opens a socket and returns helpers to send and await the next message of a type. */
async function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  await new Promise((r) => ws.on("open", r));
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next: (type) => {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve) => waiters.push({ type, resolve }));
    },
  };
}

describe("chat server", () => {
  it("joins, broadcasts messages and keeps history", async () => {
    const amy = await client();
    amy.send({ type: "join", name: "Amy", room: "test1" });
    assert.deepEqual((await amy.next("welcome")).users, ["Amy"]);

    const ben = await client();
    ben.send({ type: "join", name: "Ben", room: "test1" });
    await ben.next("welcome");
    assert.deepEqual((await amy.next("joined")).users, ["Amy", "Ben"]);

    amy.send({ type: "message", text: "  hello Ben  " });
    const got = await ben.next("message");
    assert.equal(got.text, "hello Ben");
    assert.equal(got.name, "Amy");

    const cat = await client();
    cat.send({ type: "join", name: "Cat", room: "test1" });
    assert.equal((await cat.next("welcome")).history.at(-1).text, "hello Ben");
    [amy, ben, cat].forEach((c) => c.ws.close());
  });

  it("isolates rooms and relays typing", async () => {
    const a = await client(); a.send({ type: "join", name: "Ann", room: "red" }); await a.next("welcome");
    const b = await client(); b.send({ type: "join", name: "Bob", room: "red" }); await b.next("welcome");
    const c = await client(); c.send({ type: "join", name: "Cy", room: "blue" }); await c.next("welcome");
    a.send({ type: "typing" });
    assert.equal((await b.next("typing")).name, "Ann");
    a.send({ type: "message", text: "red only" });
    await b.next("message");
    c.send({ type: "message", text: "blue" });
    assert.equal((await c.next("message")).text, "blue"); // c only sees its own room
    [a, b, c].forEach((x) => x.ws.close());
  });

  it("validates input and enforces rate limits", async () => {
    const x = await client();
    x.send({ type: "message", text: "too early" });
    assert.equal((await x.next("error")).error, "join first");
    x.send({ type: "join", name: "<script>", room: "lobby" });
    assert.match((await x.next("error")).error, /name must be/);
    x.send({ type: "join", name: "Xena", room: "rate" });
    await x.next("welcome");
    for (let i = 0; i < 4; i++) x.send({ type: "message", text: `m${i}` });
    assert.equal((await x.next("error")).error, "slow down");
    x.ws.send("not json");
    assert.equal((await x.next("error")).error, "invalid JSON");
    x.ws.close();
  });

  it("announces when someone leaves", async () => {
    const a = await client(); a.send({ type: "join", name: "Ada", room: "bye" }); await a.next("welcome");
    const b = await client(); b.send({ type: "join", name: "Bea", room: "bye" }); await b.next("welcome");
    b.ws.close();
    const left = await a.next("left");
    assert.equal(left.name, "Bea");
    assert.deepEqual(left.users, ["Ada"]);
    a.ws.close();
  });
});
