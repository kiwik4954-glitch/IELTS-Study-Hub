import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { checkPortAvailable, checkPorts, findFreePort, portBusyHint } from "./lib/ports.mjs";

function listen(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      resolve({
        server,
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("a free loopback port is reported available", async () => {
  const port = await findFreePort();
  assert.ok(Number.isInteger(port) && port > 0);
  const result = await checkPortAvailable(port);
  assert.equal(result.available, true);
  assert.equal(result.error, null);
});

test("an occupied port is reported unavailable with its error code", async () => {
  const listener = await listen();
  try {
    const result = await checkPortAvailable(listener.port);
    assert.equal(result.available, false);
    assert.equal(result.code, "EADDRINUSE");
  } finally {
    await listener.close();
  }
});

test("availability recovers once the listener closes", async () => {
  const listener = await listen();
  const busy = await checkPortAvailable(listener.port);
  assert.equal(busy.available, false);
  await listener.close();
  const free = await checkPortAvailable(listener.port);
  assert.equal(free.available, true);
});

test("multiple ports are checked independently", async () => {
  const listener = await listen();
  try {
    const free = await findFreePort();
    const results = await checkPorts([
      { port: listener.port, label: "busy" },
      { port: free, label: "free" },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0].label, "busy");
    assert.equal(results[0].available, false);
    assert.equal(results[1].available, true);
  } finally {
    await listener.close();
  }
});

test("invalid ports fail closed instead of binding", async () => {
  const result = await checkPortAvailable(0);
  assert.equal(result.available, false);
  assert.equal(result.code, "EINVAL");
});

test("busy-port hints name the port and PID without suggesting a kill", () => {
  const hint = portBusyHint(3000, { pid: 4321, envVar: "ISTS_PORT" });
  assert.match(hint, /Port 3000/);
  assert.match(hint, /pid 4321/);
  assert.match(hint, /ISTS_PORT/);
  assert.doesNotMatch(hint, /taskkill|kill/i);
});
