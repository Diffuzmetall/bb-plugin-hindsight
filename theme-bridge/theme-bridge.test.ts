import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrustedReadyMessage } from "./browser.ts";
import { PROTOCOL, VERSION } from "./palette.ts";

test("sender accepts ready only from the expected origin and live iframe source", () => {
  const expectedWindow = {} as MessageEventSource;
  const ready = { namespace: PROTOCOL, version: VERSION, kind: "ready", documentId: "document-123456789" };
  assert.equal(isTrustedReadyMessage("https://cp.example", expectedWindow, "https://cp.example", expectedWindow, ready), ready.documentId);
  assert.equal(isTrustedReadyMessage("https://evil.example", expectedWindow, "https://cp.example", expectedWindow, ready), null);
  assert.equal(isTrustedReadyMessage("https://cp.example", {} as MessageEventSource, "https://cp.example", expectedWindow, ready), null);
  assert.equal(isTrustedReadyMessage("https://cp.example", expectedWindow, "https://cp.example", expectedWindow, { ...ready, extra: true }), null);
});
