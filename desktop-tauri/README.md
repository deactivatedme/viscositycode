# desktop-tauri

The ViscosityCode desktop app: a thin Tauri 2 shell that runs the bundled
standalone host and shows its own web client in one native window. The plan is
`tmp/round2/design-tauri.json` (phases P0-P7). This folder has the scaffold
(P1), the host sidecar (P2), the bundled standalone archive (P3), the plugins,
tray and navigation rules (P4), and macOS packaging (P5).

The crate is self-contained: it has its own `Cargo.lock`, it belongs to no
workspace, and it changes no renderer or host code.

## Owner decisions (recorded 2026-11-20)

- **Data root.** Tauri owns the production data root `~/.viscositycode`. It
  never touches `~/.viscositycode-dev`, which Electron dev keeps.
- **Tauri is the shipped app.** Electron is no longer packaged or released.
  Its source stays in the repo as the dev harness and for upstream merges, and
  a dev Electron build can still attach to the host this app runs.
- **No deletes in data folders.** The shell never deletes anything in a data
  folder. If `~/.viscositycode/agent-probe` stops the standalone host from
  starting (`HostImportRequiredError`), the fix is the plan's allowlist
  alternative in shared host code (`hostRootManifest.ts`). That change belongs
  to the shared host, not this folder, and is tracked as a handoff.
- **Pinned loopback port: 49380 on macOS, 47380 on Windows.** The
  `http://127.0.0.1:<port>` origin keys the web client's localStorage and
  IndexedDB, and with them the paired session. Changing the port signs the
  window out. Windows uses a port below its dynamic range (49152-65535), where
  Hyper-V, WSL2 and Docker reserve port blocks and binding 49380 can fail with
  `EACCES`; the host retries only `EADDRINUSE`, so the app would never start.
- **Signing.** Ad-hoc signing (`bundle.macOS.signingIdentity: "-"`), with no
  notarization. Gatekeeper still asks for approval in Privacy & Security.
- **Release gaps.** Electron no longer covers these, so the shipped app lacks
  them until they are built here (see "Release gaps" below).

## Release gaps (owner decisions needed before a public release)

These Electron features have no Tauri counterpart yet. Each is a regression for
anyone moving from the Electron 2.0.0 DMG.

1. **Updates.** There is no updater (no `tauri-plugin-updater`), so an
   installed copy never updates itself. Until one lands, updating is manual:
   download the new DMG and drag `ViscosityCode.app` over the old one in
   /Applications. Quit the app first. The data root is kept. Adding the
   updater needs a signing key pair, a `latest.json` feed on GitHub Releases,
   `createUpdaterArtifacts`, and CI to sign and upload (estimated 4-6 h).
2. **Electron-created data roots.** The Electron app sealed its credential key
   with the macOS keychain (`secret-key.safe`, credential mode `os-sealed`).
   The bundled headless `serve` refuses such a root ("Credential mode change
   requires explicit activation", `src/backend/ownership/ownedSecretKey.ts`).
   The shell shows a dedicated error page for it and changes nothing, but it
   cannot use the root. Any machine that ran the Electron DMG on
   `~/.viscositycode` is affected. A migration (Electron-assisted key adoption
   through `host-key-adoption.json`, or an explicit "sign in again" activation
   that starts a fresh key) is shared host work and is not built yet.
3. **Native pickers and drag-and-drop file paths.** The web client's
   server-side folder browser and upload-based file picker stand in.
4. **Quick composer** and its global shortcut.
5. **Sleep inhibitor.** A long agent run can stop when the Mac sleeps.
6. Also missing: the browser panel, SSH environments, provider login windows,
   desktop CLI registration, and window materials (see `gaps` in the plan).

## Security surface

`capabilities/main.json` is the only capability. It applies to the `main`
window and admits remote pages only from `http://127.0.0.1:*`. It grants only
`notification:default`. The shell validates the window URL the same way
(`loopback_url` in `src/lib.rs`): http, host `127.0.0.1`, and no credentials.

Navigation (`src/navigation.rs`, mirroring Electron's `windowHardening.ts`):
the window keeps only the host's origin (including same-origin `blob:`), plus
`about:blank` and `about:srcdoc` for the web client's own frames. Every other
navigation is blocked, like Electron's `will-navigate` guard: wry reports
subframe navigations too and does not say whether a user started them, so an
MCP app or HTML visual could otherwise open URLs in the browser without a click.
Only `window.open` and `target=_blank` (the web client's openExternal
stand-in) with an http/https/mailto URL are opened in the system browser
through the opener plugin; other new windows are blocked. The opener plugin's injected link script is off because it would
need an `opener:` IPC grant; links reach the Rust new-window handler instead.

## Window and page contract

- The first window opens centered at 1280x832, clamped to the screen's work
  area (`prevent_overflow`). Later launches restore the saved geometry
  (window-state plugin).
- macOS menu bar: Tauri's default menu without its Close Window (Cmd+W)
  items (`src/menu.rs`). Closing the only window would quit the app and stop
  the host and every running agent. The Edit menu stays, because WKWebView
  routes the clipboard and select-all shortcuts through it.
- On Windows a notification click shows and focuses the window (the
  notification plugin's `on_action`), but only while the toast is on screen,
  not from the Action Center. On macOS a click only activates the app and does
  not un-minimize the window; no handler is registered there, because each
  tracked notification would park a thread and a 0.5 s main-thread poll until
  it leaves Notification Center. The web client's own `onclick` handler
  never runs: the plugin's `window.Notification` polyfill returns no object
  that gets events. Instead the web client sets `extra: { threadId }` on the
  notification (browsers ignore the option), and on a Windows click the shell
  dispatches `viscosity-shell:notification-open` on the page's `window`, a
  `CustomEvent` whose `detail` is `{ threadId }`; the web client opens that
  thread (`src/renderer/notifications.ts`). Only an id of at most 256
  characters from `A-Z a-z 0-9 - _ . :` is sent, JSON-encoded into the script.
  The event is additive: `window.viscosityShell.version` stays `1`, and a web
  client that does not know it ignores it.
- A main-frame initialization script (`src/shell_script.rs`) defines two
  globals before the web client loads:
  - `window.viscosityShell = Object.freeze({ kind: "tauri", version: 1 })`
    tells the shared web client that it runs in this shell, the host's own
    local desktop window. Bump `version` only for an incompatible change.
  - `window.viscosityHost.system`, merged with `Object.assign` into any existing
    `window.viscosityHost`: the same system facts the Electron preload exposes
    (`src/main/viscosity/system/systemInfoPreloadBridge.ts`). For Lightweight
    mode these are `totalMemoryBytes` (physical memory, or `null`),
    `lowPowerGraphics` (a Windows Remote Desktop session, `SESSIONNAME`
    `RDP-*`), and `probeWebGl` (`true` except on macOS). The optional
    `userName` is the OS account's display name, which the sidebar profile row
    shows until the user renames it: the full name on macOS and Linux
    (`getpwuid_r`), the display name on Windows (`GetUserNameExW`), else the
    login name (`USER` / `USERNAME`), and left out when none is known. It is
    read once with a 500 ms cap, at most 80 characters without control
    characters, and goes only into this window's page. The field is additive
    (`version` stays `1`): a web client without it shows the signed-in
    provider account or "Account", as in a browser.

## Identity

This is the shipped ViscosityCode app: product name `ViscosityCode`, bundle
identifier `com.viscositycode.app`, version read from the root `package.json`,
data root `~/.viscositycode`. Electron is no longer packaged or released; its
source stays as the dev harness and for upstream merges. This app installs over
an Electron `ViscosityCode.app` (same identifier), but it cannot yet open a data
root the Electron app created: see release gap 2. Both use the same owner
lease, so only one can own a root at a time.

## Package (macOS)

```sh
node desktop-tauri/scripts/stage-standalone.mjs   # full rebuild (CI recipe), extracts to resources/standalone/
cd desktop-tauri && CARGO_BUILD_JOBS=2 bun x @tauri-apps/cli@2.12.4 build --bundles app,dmg --config tauri.bundle.conf.json
node desktop-tauri/scripts/smoke.mjs              # headless: bundled serve, pairing, GET /, Electron-root refusal, watchdog, codesign, exec bits
```

`stage-standalone.mjs --reuse` stages the existing `dist/standalone` archive
without rebuilding and prints which commit it was built from; never use it for
a release. The standalone resource mapping lives only in
`tauri.bundle.conf.json`, so `cargo check`/`test` work on a fresh checkout and
do not copy the 500 MB tree into `target/`. Without it a bundle has no server
(the window shows "The ViscosityCode server is missing").

The shell passes `PORACODE_PARENT_PID` (its own pid) to `serve`, so the host
drains and releases the root if the shell dies without a clean quit.

## Develop

Rust 1.98.1 is pinned in `rust-toolchain.toml`, the same as `native/*`. On the
8 GB Mac, build with two jobs:

```sh
cd desktop-tauri
cargo check --jobs 2
cargo clippy --jobs 2 --all-targets -- -D warnings
cargo test --jobs 2
```

## Sidecar (src/sidecar.rs, src/pairing.rs, src/owner.rs)

On launch the shell starts `<standalone>/runtime/node <standalone>/lib/server.cjs
serve --no-open --host 127.0.0.1 --port <port>` (49380, or 47380 on Windows) with `PORACODE_BASE_DIR` (default
`~/.viscositycode`) and `PORACODE_SHUTDOWN_DRAIN_DEADLINE_MS=10000`. Its stdout
and stderr go to `<app log dir>/standalone-server.log` (on macOS
`~/Library/Logs/com.viscositycode.app/`), truncated per launch.

1. Ready: our child's `[poracode-server] listening at:` line on stdout. There
   is no port probe, so a foreign listener on the port cannot pass for ours, and
   no time limit while the child lives, so a slow first start is never killed.
   The child runs in its own process group (unix); the server is spawned and
   stored under the slot lock, and Quit sets an `exiting` flag there, so a quit
   during startup cannot leave an unowned server.
2. Pairing: `server.cjs pairings create --preset operator --ttl 1m --json`; the
   window opens its `localPairingUrl` (loopback http only).
3. Root busy (`HostRootInUseError`: Electron, an orphaned server, or a CLI
   `serve` owns the root): the shell does not start a second writer. It pairs
   with the existing owner and becomes its client, and it never stops that owner.
4. `HostImportRequiredError` (for example `agent-probe` in the root), a
   credential key the headless host will not adopt (an Electron-created root,
   release gap 2), and other failures show an error page. Nothing in the data
   root is changed.

The window opens at once on a `data:` loading page (`src/page.rs`; a `data:`
origin gets no IPC). A failure replaces it with an error page worded for a
missing runtime, a busy owner that could not be paired with, or anything else,
plus the details and a Retry link. Retry points at `http://retry.viscositycode.invalid/`;
the navigation handler cancels it, stops any child it still owns, and starts
again. The tray offers Show and Quit; Quit runs the same graceful stop as Cmd+Q.

5. Quit: SIGTERM (Windows: `server.cjs stop --if-pid <child>`), up to 12 s,
   then SIGKILL to the whole process group (Windows: the node process only,
   until the deferred job object lands).

Environment overrides:

- `VISCOSITY_TAURI_STANDALONE_DIR`: an extracted standalone archive (default
  `<resource dir>/standalone`, which only a bundle built with
  `tauri.bundle.conf.json` has).
- `VISCOSITY_TAURI_BASE_DIR`: the data root for smoke runs. A shell-wide
  `PORACODE_BASE_DIR` is ignored, so the shell never lands on `~/.viscositycode-dev`.
- `VC_TAURI_DEV_URL`: skip the sidecar and open this `http://127.0.0.1:<port>/`
  URL (for example the `bun run dev:web:server` loop on 3101).

```sh
VISCOSITY_TAURI_STANDALONE_DIR=/path/to/standalone \
VISCOSITY_TAURI_BASE_DIR=$PWD/../.tmp/tauri-smoke-root cargo run --jobs 2
```

## Dependencies

Every direct and transitive crate in `Cargo.lock` was published at least 7 days
before it was locked (cutoff 2026-11-13). Direct dependencies are exact pins:
tauri 2.12.5 (2.11.1 or newer is required for the remote-origin ACL fix),
tauri-build 2.7.4, and the plugins notification 2.8.1, opener 2.7.3,
single-instance 2.5.5, and window-state 2.5.0. `windows-sys` 0.61.2 (Windows
only, for total memory) is the version tauri already locks. The `tray-icon` feature is on
for the P4 tray. Before you update anything, check publish dates again.

## Icons

`icons/` was generated by `@tauri-apps/cli@2.12.4 icon` (the newest CLI release
at least 7 days old) from `branding/assets/viscositycode-logo.png`. The logo is
1123x961, so it was first padded with transparency to a 1123x1123 square. Only
the desktop outputs are kept. To regenerate after the logo changes, pad the logo
to a square, run `bun x @tauri-apps/cli@<version> icon <square.png> -o
desktop-tauri/icons`, and delete the `android/`, `ios/`, and `Square*`/`StoreLogo`
outputs.
