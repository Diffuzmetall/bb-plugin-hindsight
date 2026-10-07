// bb-plugin-hindsight — a viewport onto the Hindsight Control Plane.
//
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never bundled).
//
// The Control Plane address is the plugin's `controlPlaneUrl` setting, declared
// in server.ts and read here with useSettings(). Nothing about the deployment
// is baked into this file.
import { useCallback, useRef, useState } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useHindsightPalette, type BridgeStatus } from "./theme-bridge/browser";

type Frame =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function HindsightFrame({ controlPlaneUrl }: { controlPlaneUrl: string }) {
  const [frame, setFrame] = useState<Frame>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("waiting");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onBridgeStatus = useCallback((status: BridgeStatus) => setBridgeStatus(status), []);
  useHindsightPalette(frameRef, panelRef, controlPlaneUrl, reloadKey, onBridgeStatus);

  const reload = useCallback(() => {
    setFrame({ kind: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="outline" size="sm" onClick={reload}>
          <Icon name="RotateCcw" className="size-4" />
          Reload
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={controlPlaneUrl} target="_blank" rel="noreferrer">
            <Icon name="ExternalLink" className="size-4" />
            Open in new tab
          </a>
        </Button>
      </div>
      {frame.kind === "loading" ? (
        <p
          role="status"
          className="shrink-0 px-3 py-2 text-xs text-muted-foreground"
        >
          Loading Hindsight Control Plane…
        </p>
      ) : null}
      {frame.kind === "error" ? (
        <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">
          {frame.message}. The Hindsight container may be down.
        </p>
      ) : null}
      {bridgeStatus === "unavailable" ? (
        <p role="status" className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
          Hindsight theme bridge is unavailable. Hindsight uses its own theme.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <iframe
          ref={frameRef}
          key={reloadKey}
          src={controlPlaneUrl}
          title="Hindsight Control Plane"
          className="h-full w-full border-0"
          onLoad={() => setFrame({ kind: "ready" })}
          onError={() =>
            setFrame({
              kind: "error",
              message: `Could not load ${controlPlaneUrl}`,
            })
          }
        />
      </div>
    </div>
  );
}

function NoControlPlane() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-sm">
      <p>No Hindsight Control Plane is configured yet.</p>
      <code className="rounded bg-muted px-2 py-1 text-xs">
        bb plugin config hindsight set controlPlaneUrl https://hindsight.example.com/
      </code>
      <p className="text-xs text-muted-foreground">
        Then run <code>bb plugin reload hindsight</code>. Set the public HTTPS
        origin of your Control Plane, with a trailing slash.
      </p>
    </div>
  );
}

function HindsightPanel() {
  const { values } = useSettings();
  const configured = values?.controlPlaneUrl;
  const controlPlaneUrl = typeof configured === "string" ? configured.trim() : "";
  return controlPlaneUrl === "" ? (
    <NoControlPlane />
  ) : (
    <HindsightFrame controlPlaneUrl={controlPlaneUrl} />
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "hindsight",
    title: "Hindsight",
    icon: "Brain",
    path: "hindsight",
    component: HindsightPanel,
  });
});
