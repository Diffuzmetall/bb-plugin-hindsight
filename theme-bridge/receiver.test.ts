import assert from "node:assert/strict";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { COLOR_MAP, PROTOCOL, VERSION } from "./palette.ts";
import { closeProxy, createProxy, type ProxyConfig } from "./sidecar.ts";

const config: ProxyConfig = {
  upstreamOrigin: "http://127.0.0.1:9",
  publicOrigin: "https://cp.example",
  parentOrigin: "https://bb.example:38886",
  listenHost: "127.0.0.1",
  listenPort: 0,
  assetPathChecked: true,
};

test("receiver checks origin and source, applies a valid palette, and restores native mode", async () => {
  const server = createProxy(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const source = await fetch(`http://127.0.0.1:${address.port}/_bb-hindsight-adapter-v1/receiver.js`).then((response) => response.text());
    const posted: Array<{ message: Record<string, unknown>; origin: string }> = [];
    const styles: Array<{ nonce?: string; isConnected: boolean; textContent: string; setAttribute: (name: string, value: string) => void; remove: () => void }> = [];
    const listeners: Array<(event: { origin: string; source: object; data: Record<string, unknown> }) => void> = [];
    let dark = true;
    const parent = { postMessage: (message: Record<string, unknown>, origin: string) => posted.push({ message, origin }) };
    const documentElement = {
      dataset: {} as Record<string, string>,
      classList: {
        contains: (name: string) => name === "dark" && dark,
        toggle: (name: string, value: boolean) => { if (name === "dark") dark = value; return dark; },
      },
    };
    const document = {
      currentScript: { nonce: "nonce-fixture" },
      documentElement,
      head: { append: (style: (typeof styles)[number]) => { style.isConnected = true; styles.push(style); } },
      createElement: () => {
        const style: (typeof styles)[number] = { isConnected: false, textContent: "", setAttribute: () => undefined, remove: () => { style.isConnected = false; } };
        return style;
      },
      querySelector: () => styles.find((style) => style.isConnected) ?? null,
    };
    const context = {
      document,
      parent,
      crypto: { randomUUID: () => "doc-id-123456789" },
      addEventListener: (_name: string, listener: (event: (typeof listeners)[number] extends (event: infer E) => void ? E : never) => void) => listeners.push(listener as (typeof listeners)[number]),
      MutationObserver: class { observe() {} },
    };
    runInNewContext(source, context);
    assert.equal(posted[0]?.message.kind, "ready");
    const onMessage = listeners[0];
    assert.ok(onMessage);
    const documentId = String(posted[0]?.message.documentId);
    onMessage({ origin: "https://bb.example:38886", source: parent, data: { namespace: PROTOCOL, version: VERSION, kind: "hello" } });
    assert.equal(posted[1]?.message.kind, "ready");
    const colorKeys = [...new Set(COLOR_MAP.map(([key]) => key))];
    const colors: Record<string, unknown> = Object.fromEntries(colorKeys.map((key, index) => [key, [index, 20, 30, 255]]));
    const palette = { mode: "light", colors };
    const message = (value: unknown, extra: Record<string, unknown> = {}) => ({ namespace: PROTOCOL, version: VERSION, kind: "palette", documentId, palette: value, ...extra });
    const send = (data: Record<string, unknown>, origin = "https://bb.example:38886", source: object = parent) => onMessage({ origin, source, data });
    const malformed = [
      message({ ...palette, colors: { ...colors, background: Array(4) } }),
      message({ ...palette, colors: { ...colors, background: [0, , 0, 255] } }),
      message({ ...palette, colors: { ...colors, background: [0, 0, undefined, 255] } }),
      message({ ...palette, colors: { ...colors, background: [0, 0, 999, 255] } }),
      message({ ...palette, colors: Object.fromEntries(Object.entries(colors).slice(1)) }),
      message({ ...palette, colors: { ...colors, extra: [0, 0, 0, 255] } }),
      message({ ...palette, extra: "css" }),
      message(palette, { extra: "css" }),
      message(palette, { version: VERSION + 1 }),
      message(palette, { documentId: "stale-document-id" }),
    ];
    send(message(palette), "https://evil.example");
    send(message(palette), "https://bb.example:38886", {});
    for (const invalid of malformed) send(invalid);
    assert.equal(styles.length, 0);
    assert.equal(posted.length, 2);
    send(message(palette));
    assert.equal(styles.length, 1);
    assert.equal(styles[0]?.nonce, "nonce-fixture");
    assert.equal(dark, false);
    assert.equal(documentElement.dataset.bbHindsightPalette, "");
    assert.ok(styles[0]?.textContent.includes("--primary: #06141e;"));
    assert.ok(styles[0]?.textContent.includes("--primary-gradient: linear-gradient(135deg, #06141e, #06141e);"));
    for (const [, target] of COLOR_MAP) assert.ok(styles[0]?.textContent.includes(`--${target}:`));
    assert.ok(!styles[0]?.textContent.includes("url("));
    assert.equal(posted[2]?.message.kind, "ack");
    send({ namespace: PROTOCOL, version: VERSION, kind: "release", documentId });
    assert.equal(styles[0]?.isConnected, false);
    assert.equal(dark, true);
    assert.equal(documentElement.dataset.bbHindsightPalette, undefined);
  } finally { await closeProxy(server); }
});
