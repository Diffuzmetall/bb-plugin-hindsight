import { Agent, createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Duplex } from "node:stream";
import { COLOR_MAP, PROTOCOL, VERSION } from "./palette.ts";

export const ASSET_PATH = "/_bb-hindsight-adapter-v1/receiver.js";
const MAX_HEAD_BYTES = 64 * 1024;
const HEAD_TIMEOUT_MS = 2000;
const MAX_INSPECTIONS = 32;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export type ProxyConfig = Readonly<{
  upstreamOrigin: string;
  publicOrigin: string;
  parentOrigin: string;
  listenHost: string;
  listenPort: number;
  assetPathChecked: boolean;
}>;

function parseUrl(value: string, name: string): URL {
  try { return new URL(value); }
  catch { throw new Error(`${name} must be a valid URL`); }
}

function validatedConfig(value: unknown): ProxyConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("config must be a JSON object");
  const fields = value as Record<string, unknown>;
  const keys = ["upstreamOrigin", "publicOrigin", "parentOrigin", "listenHost", "listenPort", "assetPathChecked"];
  if (Object.keys(fields).length !== keys.length || keys.some((key) => !Object.hasOwn(fields, key))) throw new Error("config must contain only the six documented fields");
  if (typeof fields.upstreamOrigin !== "string" || typeof fields.publicOrigin !== "string" || typeof fields.parentOrigin !== "string" || typeof fields.listenHost !== "string" || typeof fields.listenPort !== "number" || typeof fields.assetPathChecked !== "boolean") throw new Error("config fields have invalid types");
  const input: ProxyConfig = { upstreamOrigin: fields.upstreamOrigin, publicOrigin: fields.publicOrigin, parentOrigin: fields.parentOrigin, listenHost: fields.listenHost, listenPort: fields.listenPort, assetPathChecked: fields.assetPathChecked };
  const upstream = parseUrl(input.upstreamOrigin, "upstreamOrigin");
  const publicOrigin = parseUrl(input.publicOrigin, "publicOrigin");
  const parentOrigin = parseUrl(input.parentOrigin, "parentOrigin");
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("upstreamOrigin must be a credential-free HTTP origin");
  if (publicOrigin.protocol !== "https:" || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash) throw new Error("publicOrigin must be a credential-free HTTPS origin");
  if (parentOrigin.protocol !== "https:" || parentOrigin.username || parentOrigin.password || parentOrigin.pathname !== "/" || parentOrigin.search || parentOrigin.hash) throw new Error("parentOrigin must be a credential-free HTTPS origin");
  if (!Number.isInteger(input.listenPort) || input.listenPort < 0 || input.listenPort > 65535 || !input.listenHost || /[\s/]/.test(input.listenHost)) throw new Error("invalid listener address");
  return Object.freeze(input);
}

function receiverSource(parentOrigin: string): string {
  const keys = [...new Set(COLOR_MAP.map(([key]) => key))];
  const jsonParent = JSON.stringify(parentOrigin).replace(/</g, "\\u003c");
  return `(() => {
    const protocol = ${JSON.stringify(PROTOCOL)};
    const version = ${VERSION};
    const parentOrigin = ${jsonParent};
    const keys = ${JSON.stringify(keys)};
    const map = ${JSON.stringify(COLOR_MAP)};
    const documentId = crypto.randomUUID();
    const nonce = document.currentScript?.nonce || "";
    let active = false;
    let paletteMode = null;
    let nativeMode = null;
    let attempts = 0;
    const validPalette = (palette) => {
      if (!palette || Object.keys(palette).length !== 2 || !["light", "dark"].includes(palette.mode) || !palette.colors || Object.keys(palette.colors).length !== keys.length || keys.some((key) => !Object.hasOwn(palette.colors, key))) return false;
      for (const key of keys) {
        const rgba = palette.colors[key];
        if (!Array.isArray(rgba) || rgba.length !== 4) return false;
        for (let channel = 0; channel < 4; channel++) {
          if (!Object.hasOwn(rgba, channel) || !Number.isInteger(rgba[channel]) || rgba[channel] < 0 || rgba[channel] > 255) return false;
        }
      }
      return true;
    };
    const color = (rgba) => rgba[3] === 255 ? "#" + rgba.slice(0, 3).map((channel) => channel.toString(16).padStart(2, "0")).join("") : "rgba(" + rgba[0] + ", " + rgba[1] + ", " + rgba[2] + ", " + (rgba[3] / 255) + ")";
    const restore = () => {
      active = false;
      delete document.documentElement.dataset.bbHindsightPalette;
      document.querySelector("style[data-bb-hindsight-palette]")?.remove();
      if (nativeMode !== null) document.documentElement.classList.toggle("dark", nativeMode);
      nativeMode = null;
    };
    const apply = (palette) => {
      const style = document.querySelector("style[data-bb-hindsight-palette]") || document.createElement("style");
      style.setAttribute("data-bb-hindsight-palette", "");
      if (nonce) style.nonce = nonce;
      const declarations = map.map(([key, target]) => "--" + target + ": " + color(palette.colors[key]) + ";");
      const primary = color(palette.colors.primary);
      declarations.push("--primary-gradient: linear-gradient(135deg, " + primary + ", " + primary + ");");
      style.textContent = ":root[data-bb-hindsight-palette]{" + declarations.join(" ") + "color-scheme:" + palette.mode + "}";
      if (!style.isConnected) document.head.append(style);
      if (nativeMode === null) nativeMode = document.documentElement.classList.contains("dark");
      paletteMode = palette.mode;
      document.documentElement.dataset.bbHindsightPalette = "";
      document.documentElement.classList.toggle("dark", palette.mode === "dark");
      active = true;
    };
    const send = (kind) => parent.postMessage({ namespace: protocol, version, kind, documentId }, parentOrigin);
    addEventListener("message", (event) => {
      const data = event.data;
      if (event.origin !== parentOrigin || event.source !== parent || !data || typeof data !== "object") return;
      if (data.kind === "hello" && Object.keys(data).length === 3 && data.namespace === protocol && data.version === version) { send("ready"); return; }
      if (Object.keys(data).length !== (data.kind === "release" ? 4 : 5) || data.namespace !== protocol || data.version !== version || data.documentId !== documentId) return;
      if (data.kind === "release") { restore(); return; }
      if (data.kind !== "palette" || !validPalette(data.palette)) return;
      attempts = 0;
      apply(data.palette);
      send("ack");
    });
    new MutationObserver(() => {
      if (!active || document.documentElement.classList.contains("dark") === (paletteMode === "dark")) return;
      if (++attempts > 8) { restore(); return; }
      document.documentElement.classList.toggle("dark", paletteMode === "dark");
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    send("ready");
  })();`;
}

function setConnectDeadline(request: ReturnType<typeof httpRequest>, secure: boolean): void {
  request.once("socket", (socket) => {
    const deadline = setTimeout(() => request.destroy(new Error("upstream connect timeout")), 5000);
    const clear = () => clearTimeout(deadline);
    if (socket.connecting) socket.once(secure ? "secureConnect" : "connect", clear);
    else clear();
    socket.once("close", clear);
  });
}

function eligibleDocument(req: IncomingMessage): boolean {
  const fetchDest = req.headers["sec-fetch-dest"];
  const accept = req.headers.accept ?? "";
  return req.method === "GET" && (fetchDest === "iframe" || fetchDest === "document" || fetchDest === undefined && accept.includes("text/html"));
}

function forwardedHeaders(incoming: IncomingMessage, upstream: URL, publicOrigin: URL, websocket: boolean): IncomingHttpHeaders {
  const connectionTokens = (incoming.headers.connection ?? "").split(",").map((value) => value.trim().toLowerCase());
  const blocked = new Set([...HOP_BY_HOP, ...connectionTokens, "proxy-connection", "forwarded"]);
  const headers: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined || blocked.has(name.toLowerCase()) || /^x-forwarded-/i.test(name) || name.toLowerCase() === "x-real-ip") continue;
    headers[name] = value;
  }
  headers.host = upstream.host;
  headers["x-forwarded-host"] = publicOrigin.host;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-for"] = incoming.socket.remoteAddress ?? "";
  if (websocket) { headers.connection = "Upgrade"; headers.upgrade = "websocket"; }
  return headers;
}

function responseHeaders(headers: IncomingHttpHeaders, extraBlocked: ReadonlySet<string> = new Set()): Record<string, string | string[]> {
  const connectionTokens = (headers.connection ?? "").split(",").map((value) => value.trim().toLowerCase());
  const blocked = new Set([...HOP_BY_HOP, ...connectionTokens, ...extraBlocked]);
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !blocked.has(name.toLowerCase())) result[name] = value;
  }
  return result;
}

function transformedHtmlHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const blocked = new Set(["content-length", "content-encoding", "content-md5", "etag", "last-modified", "accept-ranges", "expires"]);
  return { ...responseHeaders(headers, blocked), "cache-control": "no-store", "content-type": "text/html; charset=utf-8" };
}

function nonceFromHead(head: string): string | null {
  const match = head.match(/\bnonce\s*=\s*(["'])([A-Za-z0-9+/_=-]{8,256})\1/i);
  return match?.[2] ?? null;
}

function cspAllows(head: string, cspHeaders: string | string[] | undefined, origin: string): { allowed: boolean; nonce: string | null } {
  const policies = [...(Array.isArray(cspHeaders) ? cspHeaders : cspHeaders ? [cspHeaders] : [])];
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attribute = (name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    if (attribute("http-equiv")?.slice(1).find(Boolean)?.toLowerCase() !== "content-security-policy") continue;
    const content = attribute("content")?.slice(1).find((value) => value !== undefined);
    if (content === undefined) return { allowed: false, nonce: null };
    policies.push(content);
  }
  if (policies.length === 0) return { allowed: true, nonce: null };
  if (policies.some((policy) => policy.includes(","))) return { allowed: false, nonce: null };
  const nonce = nonceFromHead(head);
  const parse = (policy: string) => {
    const directives = new Map<string, string[]>();
    for (const part of policy.split(";")) {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
    }
    return directives;
  };
  const policyAllows = (directives: Map<string, string[]>, kind: "script" | "style"): boolean => {
    const sources = directives.get(`${kind}-src-elem`) ?? directives.get(`${kind}-src`) ?? directives.get("default-src");
    if (!sources) return true;
    const hasNonce = nonce !== null && sources.includes(`'nonce-${nonce}'`);
    if (kind === "script") {
      const strictDynamic = sources.includes("'strict-dynamic'");
      const containsNonceOrHash = sources.some((source) => source.startsWith("'nonce-") || source.startsWith("'sha256-") || source.startsWith("'sha384-") || source.startsWith("'sha512-"));
      if (strictDynamic && containsNonceOrHash) return hasNonce;
      if (hasNonce || sources.includes("'self'")) return true;
      return sources.includes("*") || sources.includes(origin);
    }
    const inlineForbiddenByNonce = sources.some((source) => source.startsWith("'nonce-") || source.startsWith("'sha256-") || source.startsWith("'sha384-") || source.startsWith("'sha512-"));
    return hasNonce || sources.includes("'unsafe-inline'") && !inlineForbiddenByNonce;
  };
  const all = policies.map(parse);
  const allowed = all.every((policy) => policyAllows(policy, "script") && policyAllows(policy, "style"));
  return { allowed, nonce };
}

async function inspectHead(stream: IncomingMessage, publicOrigin: string): Promise<{ prefix: Buffer; rest: AsyncIterable<Buffer>; injectable: boolean; nonce: string | null }> {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let size = 0;
  let completed = false;
  let overflow: Buffer | undefined;
  let pending: ReturnType<typeof iterator.next> | undefined;
  const deadline = Date.now() + HEAD_TIMEOUT_MS;
  while (!completed && size < MAX_HEAD_BYTES) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    let timer: NodeJS.Timeout | undefined;
    pending ??= iterator.next();
    const next = await Promise.race([
      pending,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), left); }),
    ]);
    if (timer) clearTimeout(timer);
    if (next === null) break;
    pending = undefined;
    if (next.done) { completed = true; break; }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    const remaining = MAX_HEAD_BYTES - size;
    chunks.push(chunk.subarray(0, remaining));
    size += Math.min(chunk.length, remaining);
    if (chunk.length > remaining) {
      overflow = chunk.subarray(remaining);
      break;
    }
    const text = Buffer.concat(chunks).toString("latin1");
    if (/<\/head\s*>/i.test(text)) { completed = true; break; }
  }
  const prefix = Buffer.concat(chunks);
  const head = prefix.toString("latin1");
  const close = head.search(/<\/head\s*>/i);
  const contentType = String(stream.headers["content-type"] ?? "");
  const contentEncoding = String(stream.headers["content-encoding"] ?? "identity").toLowerCase();
  const isUtf8 = !/charset\s*=\s*["']?(?!utf-?8\b)[^;\s"']+/i.test(contentType);
  const csp = cspAllows(head, stream.headers["content-security-policy"], publicOrigin);
  const injectable = close >= 0 && size <= MAX_HEAD_BYTES && isUtf8 && contentEncoding === "identity" && /^text\/html\b/i.test(contentType) && csp.allowed;
  const rest = (async function* () {
    if (typeof overflow !== "undefined") yield overflow;
    if (pending !== undefined) {
      const next = await pending;
      if (!next.done) yield Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    }
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  })();
  return { prefix, rest, injectable, nonce: csp.nonce };
}

function writeChunk(response: ServerResponse, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (response.destroyed) return reject(new Error("downstream closed"));
    if (response.writableEnded) return resolve();
    const cleanup = () => {
      response.removeListener("drain", onDrain);
      response.removeListener("close", onClose);
      response.removeListener("error", onError);
    };
    const settle = (error?: Error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => settle();
    const onClose = () => settle(new Error("downstream closed"));
    const onError = (error: Error) => settle(error);
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
    if (response.write(chunk)) settle();
  });
}

export function createProxy(configInput: unknown): Server {
  const config = validatedConfig(configInput);
  const upstream = parseUrl(config.upstreamOrigin, "upstreamOrigin");
  const publicOrigin = parseUrl(config.publicOrigin, "publicOrigin");
  const secure = upstream.protocol === "https:";
  const transport = secure ? httpsRequest : httpRequest;
  const agent = secure ? new HttpsAgent({ keepAlive: true, maxSockets: 64, maxTotalSockets: 96, maxFreeSockets: 8 }) : new Agent({ keepAlive: true, maxSockets: 64, maxTotalSockets: 96, maxFreeSockets: 8 });
  let inspections = 0;
  const upgradedSockets = new Set<Duplex>();
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (incoming, outgoing) => {
    if (incoming.url === ASSET_PATH && incoming.method === "GET") {
      const script = receiverSource(config.parentOrigin);
      outgoing.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(script), "cache-control": "no-store", "x-content-type-options": "nosniff" });
      outgoing.end(script);
      return;
    }
    if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) { outgoing.writeHead(400).end(); return; }
    const candidate = eligibleDocument(incoming);
    const headers = forwardedHeaders(incoming, upstream, publicOrigin, false);
    if (candidate) {
      delete headers["if-none-match"];
      delete headers["if-modified-since"];
      headers["accept-encoding"] = "identity";
      headers["cache-control"] = "no-cache";
    }
    const targetRequest = transport({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: incoming.method, path: incoming.url, headers, maxHeaderSize: 16 * 1024, agent }, (targetResponse) => {
      const contentType = String(targetResponse.headers["content-type"] ?? "");
      const encoding = String(targetResponse.headers["content-encoding"] ?? "identity").toLowerCase();
      const transformable = candidate && targetResponse.statusCode === 200 && /^text\/html\b/i.test(contentType) && !/charset\s*=\s*["']?(?!utf-?8\b)[^;\s"']+/i.test(contentType) && encoding === "identity";
      if (!transformable || inspections >= MAX_INSPECTIONS) {
        outgoing.writeHead(targetResponse.statusCode ?? 502, responseHeaders(targetResponse.headers));
        targetResponse.pipe(outgoing);
        return;
      }
      inspections++;
      void (async () => {
        try {
          const inspected = await inspectHead(targetResponse, config.publicOrigin);
          if (!inspected.injectable) {
            outgoing.writeHead(targetResponse.statusCode ?? 502, responseHeaders(targetResponse.headers));
            await writeChunk(outgoing, inspected.prefix);
            for await (const chunk of inspected.rest) await writeChunk(outgoing, chunk);
            outgoing.end();
            return;
          }
          const prefixText = inspected.prefix.toString("latin1");
          const headEnd = prefixText.search(/<\/head\s*>/i);
          const insertion = `<script src="${ASSET_PATH}"${inspected.nonce ? ` nonce="${inspected.nonce}"` : ""}></script>`;
          const modified = Buffer.from(prefixText.slice(0, headEnd) + insertion + prefixText.slice(headEnd), "latin1");
          outgoing.writeHead(targetResponse.statusCode ?? 502, transformedHtmlHeaders(targetResponse.headers));
          await writeChunk(outgoing, modified);
          for await (const chunk of inspected.rest) await writeChunk(outgoing, chunk);
          outgoing.end();
        } catch {
          if (!outgoing.headersSent) outgoing.writeHead(502);
          outgoing.end();
          targetResponse.destroy();
        } finally { inspections--; }
      })();
    });
    const responseDeadline = setTimeout(() => targetRequest.destroy(new Error("upstream response headers timeout")), 15_000);
    setConnectDeadline(targetRequest, upstream.protocol === "https:");
    targetRequest.once("response", () => clearTimeout(responseDeadline));
    targetRequest.on("error", () => { clearTimeout(responseDeadline); if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    incoming.on("aborted", () => { clearTimeout(responseDeadline); targetRequest.destroy(); });
    outgoing.on("close", () => { clearTimeout(responseDeadline); if (!outgoing.writableEnded) targetRequest.destroy(); });
    incoming.pipe(targetRequest);
  });
  server.on("upgrade", (incoming, client, head) => {
    if (incoming.headers.upgrade?.toLowerCase() !== "websocket" || !incoming.url?.startsWith("/") || incoming.url.startsWith("//")) { client.write("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n"); client.destroy(); return; }
    const headers = forwardedHeaders(incoming, upstream, publicOrigin, true);
    const request = transport({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: "GET", path: incoming.url, headers, maxHeaderSize: 16 * 1024, agent });
    const upgradeDeadline = setTimeout(() => request.destroy(new Error("upstream websocket handshake timeout")), 15_000);
    let upgradedSocket: Duplex | undefined;
    setConnectDeadline(request, upstream.protocol === "https:");
    const track = (socket: Duplex) => { upgradedSockets.add(socket); socket.once("close", () => upgradedSockets.delete(socket)); };
    track(client);
    request.on("response", (response) => {
      clearTimeout(upgradeDeadline);
      response.resume();
      client.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      client.destroy();
    });
    request.on("upgrade", (response, socket, upstreamHead) => {
      clearTimeout(upgradeDeadline);
      upgradedSocket = socket;
      track(socket);
      const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`, ...Object.entries(response.headers).flatMap(([name, value]) => value === undefined ? [] : Array.isArray(value) ? value.map((part) => `${name}: ${part}`) : [`${name}: ${value}`]), "", ""];
      client.write(lines.join("\r\n"));
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) socket.write(head);
      socket.on("close", () => client.destroy());
      socket.pipe(client).pipe(socket);
    });
    request.on("error", () => { clearTimeout(upgradeDeadline); client.destroy(); });
    client.on("close", () => { clearTimeout(upgradeDeadline); request.destroy(); upgradedSocket?.destroy(); });
    request.end();
  });
  server.maxConnections = 128;
  proxySockets.set(server, { sockets: upgradedSockets, agent });
  return server;
}

const proxySockets = new WeakMap<Server, { sockets: Set<Duplex>; agent: Agent | HttpsAgent }>();

export async function closeProxy(server: Server): Promise<void> {
  const resources = proxySockets.get(server);
  for (const socket of resources?.sockets ?? []) socket.destroy();
  resources?.agent.destroy();
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function startProxy(configInput: unknown): Promise<Server> {
  const checkedConfig = validatedConfig(configInput);
  if (checkedConfig.listenPort === 0) throw new Error("sidecar config must set an explicit listener port");
  if (!checkedConfig.assetPathChecked) throw new Error("verify the reserved asset path with the authenticated CP session and set assetPathChecked to true");
  const server = createProxy(checkedConfig);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(checkedConfig.listenPort, checkedConfig.listenHost, () => { server.removeListener("error", reject); resolve(); });
  });
  return server;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = process.env.HINDSIGHT_THEME_CONFIG;
  if (!configPath) throw new Error("Set HINDSIGHT_THEME_CONFIG to the sidecar JSON config path");
  let config: unknown;
  try { config = JSON.parse(await readFile(configPath, "utf8")); }
  catch { throw new Error("HINDSIGHT_THEME_CONFIG must name a readable JSON config file"); }
  const checkedConfig = validatedConfig(config);
  const server = await startProxy(checkedConfig);
  const stop = () => void closeProxy(server).then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write(`Hindsight theme proxy listening on ${checkedConfig.listenHost}:${checkedConfig.listenPort}\n`);
}
