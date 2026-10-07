import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { ASSET_PATH, closeProxy, createProxy, startProxy, type ProxyConfig } from "./sidecar.ts";

const baseConfig: ProxyConfig = {
  upstreamOrigin: "http://127.0.0.1:0",
  publicOrigin: "https://cp.example",
  parentOrigin: "https://bb.example:38886",
  listenHost: "127.0.0.1",
  listenPort: 0,
  assetPathChecked: true,
};

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withProxy(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (upstreamOrigin: string, proxyOrigin: string) => Promise<void>): Promise<void> {
  const upstream = createServer(handler);
  let proxy: Server | undefined;
  try {
    const upstreamOrigin = await listen(upstream);
    proxy = createProxy({ ...baseConfig, upstreamOrigin });
    const proxyOrigin = await listen(proxy);
    await run(upstreamOrigin, proxyOrigin);
  } finally {
    if (proxy) await closeProxy(proxy);
    await stop(upstream);
  }
}

test("sidecar config rejects credentials, insecure origins, and unknown keys", async () => {
  assert.throws(() => createProxy({ ...baseConfig, upstreamOrigin: "http://user:pass@127.0.0.1:9999" }), /credential-free/);
  assert.throws(() => createProxy({ ...baseConfig, parentOrigin: "http://bb.example:38886" }), /HTTPS origin/);
  assert.throws(() => createProxy({ ...baseConfig, requestUrl: "http://untrusted.example" }), /only the six documented fields/);
  await assert.rejects(startProxy({ ...baseConfig, listenPort: 9944, assetPathChecked: false }), /verify the reserved asset path/);
});

test("proxy preserves raw paths, auth inputs, redirect, and separate cookies", async () => {
  let received: { url?: string; cookie?: string; authorization?: string; origin?: string; forwarded?: string | string[]; xForwardedFor?: string | string[] } = {};
  await withProxy((req, res) => {
    received = { url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization, origin: req.headers.origin, forwarded: req.headers.forwarded, xForwardedFor: req.headers["x-forwarded-for"] };
    res.writeHead(302, { location: "/login?next=%2Fraw%2Fpath", "set-cookie": ["session=one; Path=/; HttpOnly", "csrf=two; Path=/; SameSite=Lax"], "x-frame-options": "SAMEORIGIN" });
    res.end("redirect");
  }, async (_origin, proxyOrigin) => {
    const response = await fetch(`${proxyOrigin}/raw%2Fpath?a=%2F&b=1`, { redirect: "manual", headers: { cookie: "session=fixture", authorization: "Bearer fixture", origin: "https://bb.example:38886", forwarded: "for=attacker", "x-forwarded-for": "spoofed" } });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login?next=%2Fraw%2Fpath");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.deepEqual(response.headers.getSetCookie(), ["session=one; Path=/; HttpOnly", "csrf=two; Path=/; SameSite=Lax"]);
    assert.equal(received.url, "/raw%2Fpath?a=%2F&b=1");
    assert.equal(received.cookie, "session=fixture");
    assert.equal(received.authorization, "Bearer fixture");
    assert.equal(received.origin, "https://bb.example:38886");
    assert.equal(received.forwarded, undefined);
    assert.notEqual(received.xForwardedFor, "spoofed");
  });
});

test("HTML injection uses an existing nonce and exposes a fixed-origin receiver", async () => {
  const html = "<!doctype html><html><head><script nonce=\"nonce-fixture-123456\"></script></head><body>ok</body></html>";
  await withProxy((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src 'self' 'nonce-nonce-fixture-123456'; style-src 'nonce-nonce-fixture-123456'", etag: '"old"', "content-length": Buffer.byteLength(html) });
    res.end(html);
  }, async (_origin, proxyOrigin) => {
    const response = await fetch(proxyOrigin, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
    assert.match(body, new RegExp(`<script src="${ASSET_PATH.replaceAll("/", "\\/")}" nonce="nonce-fixture-123456"></script>`));
    const script = await fetch(`${proxyOrigin}${ASSET_PATH}`).then((result) => result.text());
    assert.ok(script.includes('"https://bb.example:38886"'));
    assert.ok(script.includes("data-bb-hindsight-palette"));
  });
});

test("compressed HTML passes through byte-for-byte", async () => {
  const html = Buffer.from("<html><head></head><body>compressed</body></html>");
  const compressed = gzipSync(html);
  await withProxy((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", "content-length": compressed.length, etag: '"compressed"' });
    res.end(compressed);
  }, async (_origin, proxyOrigin) => {
    const target = new URL(proxyOrigin);
    const response = await new Promise<{ status: number | undefined; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
      const request = httpRequest({ hostname: target.hostname, port: target.port, path: "/", headers: { accept: "text/html", "sec-fetch-dest": "iframe" } }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) }));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.equal(response.headers.etag, '"compressed"');
    assert.deepEqual(response.body, compressed);
  });
});

test("HTML requiring unauthorized inline styles passes through without injection", async () => {
  const html = "<html><head><meta content=\"script-src 'self'; style-src 'self'\" http-equiv=\"Content-Security-Policy\"><script src=\"/x.js\"></script></head><body>plain</body></html>";
  await withProxy((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  }, async (_origin, proxyOrigin) => {
    const response = await fetch(proxyOrigin, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
    assert.equal(await response.text(), html);
    assert.equal(response.headers.get("cache-control"), null);
  });
});

test("CSP duplicate directives, policy lists, and strict-dynamic fail closed", async () => {
  const html = "<html><head></head><body>plain</body></html>";
  const policies = [
    "script-src 'none'; script-src 'self'; style-src 'unsafe-inline'",
    "script-src 'none'; style-src 'unsafe-inline', script-src 'self'; style-src 'unsafe-inline'",
    "script-src 'nonce-not-in-head' 'strict-dynamic' https://cp.example; style-src 'unsafe-inline'",
  ];
  await withProxy((req, res) => {
    const index = Number(new URL(req.url ?? "/", "http://fixture").searchParams.get("case"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": policies[index] ?? "default-src 'none'" });
    res.end(html);
  }, async (_origin, proxyOrigin) => {
    for (let index = 0; index < policies.length; index++) {
      const response = await fetch(`${proxyOrigin}/?case=${index}`, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
      assert.equal(await response.text(), html, `policy ${index} must pass through unchanged`);
    }
  });
});

test("disconnected slow readers release all inspected HTML slots", { timeout: 5000 }, async () => {
  const html = "<html><head></head><body>ok</body></html>";
  const slowBody = Buffer.alloc(8 * 1024 * 1024, 65);
  await withProxy((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.url === "/slow") {
      res.write("<html><head></head><body>");
      res.end(slowBody);
    } else res.end(html);
  }, async (_origin, proxyOrigin) => {
    const requests: ReturnType<typeof httpRequest>[] = [];
    const responses: IncomingMessage[] = [];
    const waiting: Promise<void>[] = [];
    for (let index = 0; index < 32; index++) {
      waiting.push(new Promise<void>((resolve, reject) => {
        const request = httpRequest(`${proxyOrigin}/slow`, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } }, (response) => {
          response.pause();
          responses.push(response);
          resolve();
        });
        requests.push(request);
        request.on("error", reject);
        request.end();
      }));
    }
    await Promise.all(waiting);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const saturated = await fetch(proxyOrigin, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
    assert.equal(await saturated.text(), html, "all 32 slow responses should occupy inspection slots");
    for (const response of responses) response.destroy();
    for (const request of requests) request.destroy();
    const deadline = Date.now() + 1500;
    let recovered = false;
    while (Date.now() < deadline) {
      const response = await fetch(proxyOrigin, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
      const body = await response.text();
      if (body.includes(ASSET_PATH)) { recovered = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(recovered, true, "inspection quota should recover after downstream close");
  });
});

test("head inspection holds no more than its budget and preserves oversized documents", async () => {
  const html = `<html><head>${"x".repeat(70 * 1024)}</head><body>tail</body></html>`;
  await withProxy((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
    res.end(html);
  }, async (_origin, proxyOrigin) => {
    const response = await fetch(proxyOrigin, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
    assert.equal(await response.text(), html);
    assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(html)));
  });
});

test("HTML head inspection releases an incomplete prefix at its deadline", { timeout: 5000 }, async () => {
  const prefix = "<html><head>slow";
  await withProxy((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.write(prefix);
    setTimeout(() => res.end("</body></html>"), 2300);
  }, async (_origin, proxyOrigin) => {
    const started = Date.now();
    const response = await fetch(proxyOrigin, { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } });
    assert.equal(await response.text(), `${prefix}</body></html>`);
    assert.ok(Date.now() - started >= 1900);
    assert.ok(Date.now() - started < 3000);
  });
});

test("uploads, delayed SSE, and client disconnects stay streamed", async () => {
  let upstreamClosed = false;
  await withProxy((req, res) => {
    if (req.url === "/upload") {
      const pieces: Buffer[] = [];
      req.on("data", (piece: Buffer) => pieces.push(piece));
      req.on("end", () => { res.end(`${req.method}:${Buffer.concat(pieces).toString()}`); });
      return;
    }
    if (req.url === "/disconnect") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: open\n\n");
      res.on("close", () => { upstreamClosed = true; });
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: first\n\n");
    setTimeout(() => { res.end("data: second\n\n"); }, 300);
  }, async (_origin, proxyOrigin) => {
    const uploaded = await fetch(`${proxyOrigin}/upload`, { method: "POST", body: "upload-fixture", headers: { "content-type": "application/octet-stream" } });
    assert.equal(await uploaded.text(), "POST:upload-fixture");
    const started = Date.now();
    const events = await fetch(`${proxyOrigin}/events`, { headers: { accept: "text/event-stream" } });
    assert.equal(events.headers.get("content-type"), "text/event-stream");
    const reader = events.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /data: first/);
    assert.ok(Date.now() - started < 250);
    const second = await reader.read();
    assert.match(new TextDecoder().decode(second.value), /data: second/);
    await reader.cancel();
    const controller = new AbortController();
    const disconnect = await fetch(`${proxyOrigin}/disconnect`, { signal: controller.signal, headers: { accept: "text/event-stream" } });
    await disconnect.body?.getReader().read();
    controller.abort();
    for (let attempt = 0; attempt < 25 && !upstreamClosed; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(upstreamClosed, true);
  });
});

test("websocket upgrade reaches the upstream and disconnect closes both sides", async () => {
  let upgraded = false;
  const upstream = createServer();
  upstream.on("upgrade", (req, socket) => {
    upgraded = true;
    const key = req.headers["sec-websocket-key"] ?? "";
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", () => { socket.write(Buffer.from([0x88, 0])); socket.end(); });
  });
  const upstreamOrigin = await listen(upstream);
  const proxy = createProxy({ ...baseConfig, upstreamOrigin });
  const proxyOrigin = await listen(proxy);
  try {
    const socketUrl = proxyOrigin.replace("http:", "ws:");
    const ws = new WebSocket(`${socketUrl}/socket`);
    await once(ws, "open");
    assert.equal(upgraded, true);
    ws.close();
    await once(ws, "close");
  } finally { await closeProxy(proxy); await stop(upstream); }
});

test("non-upgrade protocol requests fail closed", async () => {
  await withProxy((_req, res) => res.end("unused"), async (_origin, proxyOrigin) => {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(proxyOrigin.replace("http://", "http://") + "/ws", { headers: { connection: "Upgrade", upgrade: "h2c" } }, (response) => {
        assert.equal(response.statusCode, 501);
        response.resume();
        response.on("end", resolve);
      });
      request.on("error", reject);
      request.end();
    });
  });
});
