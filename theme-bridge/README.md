# Hindsight theme adapter

The BB panel is an iframe on a different origin from BB, so BB's palette cannot
reach it, and the Hindsight image has no external palette receiver. This
directory adds one without touching Hindsight: a small Node sidecar keeps the
Control Plane (CP) on its existing HTTPS origin and root paths, forwards to the
fixed CP upstream, and injects a receiver into eligible HTML. The BB panel
samples its effective color tokens and posts them to its own iframe.

No Hindsight source, image, or asset file changes. The adapter is a separate
block: it can be removed, and it can move to another host, without a source fork.

## How it works

```
BB panel (sender)                     sidecar (this directory)          CP upstream
  samples --background, --primary,      /_bb-hindsight-adapter-v1/         http://<cp>:9999
  --card, hs-* … into sRGB              receiver.js  ──┐
        │                                             │
        │ postMessage (origin + window checked)        │
        └──────────────► CP HTML ◄────────────────────┘
                          receiver sets the mapped CSS variables
```

The sidecar needs Node 24 or later with native TypeScript stripping. It binds to
loopback by default. `proxy.example.json` holds the six configuration fields;
copy it to a protected path and edit it before starting the sidecar.

| field | meaning |
| --- | --- |
| `upstreamOrigin` | The CP itself (its web origin, not its API port). |
| `publicOrigin` | The HTTPS origin users reach the CP on, unchanged. |
| `parentOrigin` | The BB origin allowed to send a palette. |
| `listenHost`, `listenPort` | Where the sidecar listens; loopback by default. |
| `assetPathChecked` | Operator proof that the reserved receiver path is free on this CP. |

## Deploy

Run these commands on the BB plugin host to copy the self-contained directory to
the Hindsight host. Set `HINDSIGHT_HOST` to the operator-approved SSH target.

```sh
export HINDSIGHT_HOST='<hindsight-host>'
ssh "$HINDSIGHT_HOST" 'install -d -m 755 /opt/hindsight-theme'
scp -r theme-bridge "$HINDSIGHT_HOST:/opt/hindsight-theme/"
```

On the Hindsight host, install the example config at a path readable only by the
service account, and edit it before starting the sidecar. Keep
`assetPathChecked` false until an operator verifies the reserved receiver path
from an authenticated CP session, then set it to true. The sidecar sends no
credentials or cookies for this check.

```sh
install -d -m 700 /etc/hindsight-theme
install -m 600 /opt/hindsight-theme/theme-bridge/proxy.example.json /etc/hindsight-theme/proxy.json
${EDITOR:-vi} /etc/hindsight-theme/proxy.json
sed -i 's/"assetPathChecked": false/"assetPathChecked": true/' /etc/hindsight-theme/proxy.json
```

Start the sidecar in the service manager chosen by the operator. This direct
command runs it in the foreground and prints only its bind address.

```sh
HINDSIGHT_THEME_CONFIG=/etc/hindsight-theme/proxy.json node --experimental-strip-types /opt/hindsight-theme/theme-bridge/sidecar.ts
```

Before changing public routing, confirm that the sidecar starts and that
`/_bb-hindsight-adapter-v1/receiver.js` returns JavaScript from loopback. The
sidecar refuses to start until `assetPathChecked` is true. The operator must
first confirm that the reserved path does not exist while authenticated to the
CP. An unauthenticated redirect to login does not prove that the path is free.
Keep the existing HTTPS termination and authentication path.

```sh
curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:9944/_bb-hindsight-adapter-v1/receiver.js
```

After the BB plugin build succeeds, reload the installed plugin.

```sh
npm run build
bb plugin reload hindsight
```

The operator changes the existing public routing target only after validating
the sidecar. The public HTTPS origin and port stay as they are; only the local
target behind the TLS terminator moves to the sidecar.

```sh
tailscale serve --bg --https=9444 http://127.0.0.1:9944
```

The sidecar has no reload signal. Restart it through its service manager after
changing code or config. With the foreground command, press Ctrl-C, then run the
command again.

## Move to another host

Copy the `theme-bridge` directory without credentials; create a separate
protected runtime config on the destination. Set `upstreamOrigin` to that host's
Control Plane (not its API port), `publicOrigin` to the preserved or new public
CP origin, and `parentOrigin` to the new BB origin. Repeat the authenticated
reserved-path check on that CP; do not reuse the old `assetPathChecked` proof.

If `publicOrigin` changes, set the plugin's `controlPlaneUrl` to the same public
CP origin, then rebuild and reload the BB plugin:

```sh
bb plugin config hindsight set controlPlaneUrl 'https://<new-cp-origin>/'
bb plugin reload hindsight
```

Adapt the service's Node executable, `WorkingDirectory`, and
`HINDSIGHT_THEME_CONFIG` path to the destination. Preserve HTTPS termination,
authentication and cookie handling, and the direct-CP/sender-free-plugin
rollback path. A Hindsight upgrade is not assumed compatible; verify CSP, HTML,
and palette tokens before routing traffic.

## Roll back

Restore direct CP routing before stopping the sidecar. This keeps Hindsight
reachable while the plugin sender is rolled back.

```sh
tailscale serve --bg --https=9444 http://<cp-upstream>
```

On the BB plugin host, install a preserved sender-free plugin build (any
directory holding the artifacts you built before the theme bridge). This does
not overwrite the current source tree.

```sh
bb plugin install <path-to-preserved-artifacts> --yes
bb plugin reload hindsight
```

Stop the sidecar with its service manager after direct routing and the
sender-free plugin are active. Keep its files for a later retry.

## Boundaries and limits

- The proxy forwards raw paths and request bodies to the configured upstream. It
  preserves cookies, separate `Set-Cookie` values, redirects, authorization,
  security headers, SSE, WebSocket frames, and streamed responses.
- It accepts no request-selected upstream. It removes client-supplied forwarding
  headers and sets forwarding metadata from the incoming socket and configured
  public origin.
- It buffers at most 64 KiB of an HTML head for at most two seconds, across at
  most 32 inspections. The ordinary HTTP agent pool allows at most 96 upstream
  sockets. Upgraded WebSocket sockets are tracked for shutdown but sit outside
  that pool limit. The listener caps client connections at 128. Other traffic
  streams without HTML inspection.
- It injects only into successful UTF-8 HTML when all enforced header and head
  meta CSP policies authorize the receiver script and inline style. Otherwise,
  CP HTML passes through unchanged.
- The receiver accepts only messages from the configured BB origin and
  `window.parent`. The sender also checks the exact CP origin and current iframe
  window. Palette values are finite numeric sRGB channels; no custom CSS crosses
  the bridge.
- The bridge covers mapped design tokens, not arbitrary BB CSS, CP chart/status
  colors, or hardcoded CP switch/table colors. It does not theme a CP tab opened
  outside the BB iframe.
- A Hindsight upgrade can change CSP, HTML, or token names. Recheck those
  compatibility gates before routing production traffic through a new CP image.

## Verify locally

```sh
npm run typecheck
npm test
npm run build
```

Tests use synthetic HTTP fixtures. They do not prove production login, CSRF,
graph, browser palette preview/cancel, or TLS-terminator behavior.
