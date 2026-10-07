Browse your Hindsight memory banks inside BB, in the sidebar next to the threads
they belong to.

## What you get

- A **Hindsight** panel in BB's left rail: the same Control Plane you already
  use, with **Reload** and **Open in new tab**.
- Optional theme following, so the panel tracks BB's light, dark, or custom
  palette instead of keeping its own.
- A safe fallback. If the theme bridge is not deployed, the Control Plane loads
  unchanged behind a one-line notice.

## How it works

The panel embeds the Control Plane at the HTTPS origin you configure with
`bb plugin config hindsight set controlPlaneUrl`. Hindsight keeps its own origin,
login, and data, and no Hindsight source or image is modified.

Theme following is a separate block. A small Node sidecar keeps the Control
Plane on its existing origin and injects a receiver into eligible HTML; the panel
then samples BB's effective color tokens and posts them into its own frame.
Palette values cross the bridge as numeric sRGB channels only, with origin and
window identity checked on both sides. Deploy and rollback steps are in the
repository's [`theme-bridge/README.md`](https://github.com/Diffuzmetall/bb-plugin-hindsight/blob/main/theme-bridge/README.md).

## Requirements

BB `>=0.45`, a Hindsight Control Plane on one HTTPS origin, and — for theme
following only — Node 24 or later on the Control Plane host.

## Install

```sh
git clone https://github.com/Diffuzmetall/bb-plugin-hindsight.git
cd bb-plugin-hindsight
npm install
npm run build
bb plugin install . --yes

bb plugin config hindsight set controlPlaneUrl 'https://hindsight.example.com/'
bb plugin reload hindsight
```

`dist/` is not committed, so the plugin is built from source before install. The
Control Plane address is a setting rather than source code, so your deployment
details never live in the repository.
