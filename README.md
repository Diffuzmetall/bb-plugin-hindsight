# BB Hindsight

[![CI](https://github.com/Diffuzmetall/bb-plugin-hindsight/actions/workflows/ci.yml/badge.svg)](https://github.com/Diffuzmetall/bb-plugin-hindsight/actions/workflows/ci.yml)

A standalone BB plugin that puts a **Hindsight Control Plane** in BB's left rail
as a **Hindsight** panel, and — optionally — makes that panel follow BB's current
theme. It is a viewport: your Hindsight deployment keeps its own origin, login,
and data, and no Hindsight source or image changes.

## What you get

- A **Hindsight** entry in BB's left rail that browses memory banks next to the
  threads they belong to, with **Reload** and **Open in new tab**.
- Optional palette following: the embedded Control Plane tracks BB's light,
  dark, or custom theme instead of keeping its own.
- A fallback that stays useful: if the theme bridge is not deployed, the panel
  loads the Control Plane unchanged and says so.

## Requirements

- BB `>=0.45`.
- Hindsight reachable at one HTTPS origin (the panel loads that origin directly).
- For theme following only: a host that can run the Node sidecar from
  [`theme-bridge/`](theme-bridge/README.md) — Node 24 or later.

## Install

`dist/` is not committed, so build before installing:

```sh
git clone https://github.com/Diffuzmetall/bb-plugin-hindsight.git
cd bb-plugin-hindsight
npm install
npm run build
bb plugin install . --yes
```

## Configure

The Control Plane address is a plugin setting, so nothing about your deployment
lives in this repository:

```sh
bb plugin config hindsight set controlPlaneUrl 'https://hindsight.example.com/'
bb plugin reload hindsight
```

Use the public HTTPS origin of the Control Plane, with a trailing slash. Until
it is set, the panel explains this command instead of showing an empty frame.

## Theme following (optional)

An iframe on another origin cannot inherit BB's palette. `theme-bridge/` adds
that without touching Hindsight: a small Node sidecar keeps the Control Plane on
its existing HTTPS origin, forwards to the fixed upstream, and injects a
receiver into eligible HTML. This plugin's panel samples BB's effective color
tokens and posts them into its own frame; the receiver applies the mapped
variables.

It is a separate, removable block. Nothing in the plugin's own behavior depends
on it — no bridge, no problem, just Hindsight's own theme.

Deployment, host transfer, rollback, and the exact compatibility gates are in
[`theme-bridge/README.md`](theme-bridge/README.md).

## How it works

- `app.tsx` registers one `navPanel` slot. It reads the `controlPlaneUrl`
  setting, renders the Control Plane in an iframe, and shows loading, error, and
  bridge-unavailable states in a small toolbar above it.
- `theme-bridge/browser.ts` samples BB's effective design tokens through a
  hidden probe element resolved with a canvas, so custom themes and dark mode
  are read as they actually paint, and posts them to the frame on change.
- `theme-bridge/sidecar.ts` proxies the Control Plane byte-for-byte — cookies,
  redirects, SSE, WebSockets, streamed responses — and injects a receiver script
  only into successful HTML whose enforced CSP already authorizes it.
- `theme-bridge/palette.ts` is the single source of the token map, shared by the
  sender, the receiver, and their tests.
- `server.ts` declares the setting and nothing else.

## Security and privacy

- The plugin stores one URL string. It holds no credentials and sends no
  Hindsight data anywhere; the iframe loads your Control Plane exactly as a
  browser tab would, behind Hindsight's own authentication.
- Palette values cross the bridge as finite numeric sRGB channels only. No CSS
  text is accepted, and both sides check origin, protocol version, and window
  identity, so a foreign frame cannot style or be styled by the panel.
- The sidecar binds loopback, accepts no request-selected upstream, removes
  client-supplied forwarding headers, and never weakens an upstream CSP.
- The theme bridge is optional and independently removable, so a failed deploy
  degrades to an unthemed Control Plane rather than an unreachable one.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node test runner; 14 forwarding and bridge-boundary cases
npm run build       # bb plugin build . → dist/
bb plugin reload hindsight
```

Tests use synthetic HTTP fixtures and Node's built-in test runner. They cover
proxy forwarding, header hygiene, WebSocket upgrades, CSP gating, receiver
validation and styling, and sender message acceptance. They do not prove
production login, CSRF, or graph behavior — check those against a live Control
Plane.

The sidecar has no dependencies beyond Node's standard library.

## Compatibility and limits

- Theme following covers mapped design tokens, not arbitrary BB CSS, Control
  Plane chart or status colors, or hardcoded Control Plane switch and table
  colors. It does not theme a Control Plane tab opened outside BB.
- A Hindsight upgrade can change HTML, CSP, or token names. Recheck those gates
  before routing traffic through a new image.
- The plugin is pinned to the Plugin SDK it was built against
  (`engines.bbPluginSdk`); run `bb plugin types` to move the pin to the BB you
  run, then rebuild.

## Prior art and thanks

Built on the BB Plugin SDK by [get-bb/bb](https://github.com/get-bb/bb). The
vendored components under `components/ui/` follow the BB registry (shadcn)
model: this source is owned by the plugin, not updated from upstream.

## License

[MIT](LICENSE) © bb-plugin-hindsight contributors
