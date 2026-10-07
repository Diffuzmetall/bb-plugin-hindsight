// bb-plugin-hindsight — backend entry.
//
// The plugin is a pure iframe viewport: all of its behavior lives in app.tsx,
// so the backend only declares the Control Plane address and announces load.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    controlPlaneUrl: {
      type: "string",
      label: "Control Plane URL",
      description:
        "Public HTTPS origin of the Hindsight Control Plane this panel embeds, e.g. https://hindsight.example.com/",
      default: "",
    },
  });
  bb.log.info("loaded");
}
