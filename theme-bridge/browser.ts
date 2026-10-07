import { useEffect, type RefObject } from "react";
import { COLOR_MAP, PROTOCOL, VERSION, type Palette, type Rgba8 } from "./palette.ts";

export type BridgeStatus = "waiting" | "ready" | "unavailable";

export function isTrustedReadyMessage(
  origin: string,
  source: MessageEventSource | null,
  expectedOrigin: string,
  expectedSource: MessageEventSource | null,
  value: unknown,
): string | null {
  if (origin !== expectedOrigin || source !== expectedSource || typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 4 || data.namespace !== PROTOCOL || data.version !== VERSION || data.kind !== "ready" || typeof data.documentId !== "string" || data.documentId.length < 16 || data.documentId.length > 80) return null;
  return data.documentId;
}

export function useHindsightPalette(
  frameRef: RefObject<HTMLIFrameElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  controlPlaneUrl: string,
  frameInstanceKey: number,
  onStatus: (status: BridgeStatus) => void,
): void {
  useEffect(() => {
    const frame = frameRef.current;
    const panel = panelRef.current;
    if (frame === null || panel === null) return;
    let targetOrigin: string;
    try { targetOrigin = new URL(controlPlaneUrl).origin; }
    catch { onStatus("unavailable"); return; }
    const probe = panel.ownerDocument.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none";
    panel.append(probe);
    const canvas = panel.ownerDocument.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let documentId: string | null = null;
    let lastLoadedDocumentId: string | null = null;
    let readyTimer: number | undefined;
    let animation = 0;
    let lastSignature = "";
    let disposed = false;

    const sample = (): Palette | null => {
      if (context === null) return null;
      const colors = {} as Record<(typeof COLOR_MAP)[number][0], Rgba8>;
      for (const [key] of COLOR_MAP) {
        if (key in colors) continue;
        probe.style.color = `var(--${key})`;
        const resolved = getComputedStyle(probe).color;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = resolved;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        if (![r, g, b, a].every(Number.isFinite)) return null;
        colors[key] = [r, g, b, a];
      }
      const mode = panel.ownerDocument.documentElement.classList.contains("dark") ? "dark" : "light";
      return { mode, colors } as Palette;
    };

    const sendPalette = () => {
      animation = 0;
      const target = frame.contentWindow;
      if (disposed || target === null || documentId === null) return;
      const palette = sample();
      if (palette === null) return;
      const signature = JSON.stringify(palette);
      if (signature === lastSignature) return;
      lastSignature = signature;
      target.postMessage({ namespace: PROTOCOL, version: VERSION, kind: "palette", documentId, palette }, targetOrigin);
    };

    const schedule = () => {
      if (animation === 0) animation = requestAnimationFrame(sendPalette);
    };

    const startDocumentWait = () => {
      documentId = null;
      lastSignature = "";
      onStatus("waiting");
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      readyTimer = window.setTimeout(() => {
        if (documentId === null) onStatus("unavailable");
      }, 2500);
      frame.contentWindow?.postMessage({ namespace: PROTOCOL, version: VERSION, kind: "hello" }, targetOrigin);
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      const readyId = isTrustedReadyMessage(event.origin, event.source, targetOrigin, frame.contentWindow, event.data);
      if (readyId === null) return;
      documentId = readyId;
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      onStatus("ready");
      lastSignature = "";
      schedule();
    };

    const onLoad = () => {
      if (documentId === null || documentId === lastLoadedDocumentId) startDocumentWait();
      else { lastLoadedDocumentId = documentId; schedule(); }
    };
    const rootObserver = new MutationObserver(schedule);
    rootObserver.observe(panel.ownerDocument.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    const themeStyleObserver = new MutationObserver(schedule);
    let observedThemeStyle: HTMLElement | null = null;
    const observeThemeStyle = () => {
      const themeStyle = panel.ownerDocument.getElementById("bb-app-theme");
      if (themeStyle === observedThemeStyle) return;
      themeStyleObserver.disconnect();
      observedThemeStyle = themeStyle;
      if (themeStyle !== null) themeStyleObserver.observe(themeStyle, { childList: true, characterData: true, subtree: true, attributes: true });
    };
    const headObserver = new MutationObserver(observeThemeStyle);
    headObserver.observe(panel.ownerDocument.head, { childList: true });
    observeThemeStyle();
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", onLoad);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", schedule);
    startDocumentWait();

    return () => {
      disposed = true;
      if (animation !== 0) cancelAnimationFrame(animation);
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      const target = frame.contentWindow;
      if (documentId !== null && target !== null) target.postMessage({ namespace: PROTOCOL, version: VERSION, kind: "release", documentId }, targetOrigin);
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", onLoad);
      media.removeEventListener("change", schedule);
      rootObserver.disconnect();
      themeStyleObserver.disconnect();
      headObserver.disconnect();
      probe.remove();
    };
  }, [controlPlaneUrl, frameInstanceKey, frameRef, panelRef, onStatus]);
}
