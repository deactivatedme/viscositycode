# Building ViscosityCode

ViscosityCode ships as a Tauri app: the native shell in [`desktop-tauri/`](desktop-tauri/README.md) runs the bundled standalone host (its own Node runtime plus the server) and shows the web client in one window. This guide covers making the installers. For day-to-day development (`bun run dev`, checks, tests), see [AGENTS.md](AGENTS.md).

Electron is no longer packaged or released. Its source stays in the repo as the development harness (`bun run dev`) and for upstream merges; the `bun run dist*` scripts still exist but their output is not a supported release.

## What you get

| Platform              | Installer (under `desktop-tauri/target/release/bundle/`)                  | Where it can be built                   |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| macOS (Apple silicon) | `dmg/ViscosityCode_<version>_aarch64.dmg` (and `macos/ViscosityCode.app`) | an Apple silicon Mac, or GitHub Actions |
| macOS (Intel)         | `dmg/ViscosityCode_<version>_x64.dmg`                                     | GitHub Actions                          |
| Windows x64           | `nsis/ViscosityCode_<version>_x64-setup.exe`                              | GitHub Actions                          |

There is no Windows Arm64 build. The local staging script builds only the Apple silicon host archive, so Intel and Windows installers come from the GitHub workflow.

## Tools

- **Bun**, the exact version in `package.json` (`packageManager`), and **Node.js 26.13.0** or newer.
- **Rust 1.98.1** (via [rustup](https://rustup.rs)). `desktop-tauri/rust-toolchain.toml` pins it, and the host archive's native helpers use it too.
  - macOS: `rustup target add aarch64-apple-darwin` (add `x86_64-apple-darwin` for Intel).
  - Windows: `rustup target add x86_64-pc-windows-msvc`.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Visual Studio Build Tools with the "Desktop development with C++" workload (MSVC), the Microsoft Edge WebView2 runtime (already on Windows 10 and 11; the installer downloads it when missing), and Git for Windows.
- **Tauri CLI:** `@tauri-apps/cli` 2.12.4, fetched on demand by `bun x` or `npx`; nothing to install.

## Build on a Mac (Apple silicon)

```sh
bun install
bun run tauri:stage    # build the standalone host archive and stage it into desktop-tauri/resources/standalone/
bun run tauri:build    # ViscosityCode.app and the DMG
bun run tauri:smoke    # headless check of the bundled host; never opens the app
```

- `tauri:stage` runs the same recipe as CI (`build:web`, the native prepares, `assemble-server-tarball.mjs`, `build-standalone-archive.mjs`) and takes a while. `bun run tauri:stage --reuse` stages the archive already in `dist/standalone/` without rebuilding; never use it for a release.
- `tauri:build` compiles with `CARGO_BUILD_JOBS=2` to keep an 8 GB Mac usable. It passes `--config tauri.bundle.conf.json`, which maps the staged host into the bundle; a bundle built without it shows "The ViscosityCode server is missing".
- Building the DMG can briefly show a Finder window on the mounted image.
- `tauri:smoke` starts the bundled server on a throwaway data folder under `.tmp/`, pairs, loads the web client, checks the parent-process watchdog, the refusal of an Electron-created data folder, `codesign --verify` and the executable bits. Pass `--app <path>` to check another copy.

## Build on Windows

There is no local staging script for Windows yet; use the GitHub workflow. By hand: take the `win32-x64` standalone zip from a workflow run (artifact `viscosity-server-standalone-win32-x64-*`), expand it into `desktop-tauri\resources\standalone\`, then:

```powershell
cd desktop-tauri
bun x @tauri-apps/cli@2.12.4 build --bundles nsis --config tauri.bundle.conf.json
```

The Windows build has not yet run on a real Windows machine.

## Signing and notarisation

Never put certificates or passwords in committed files; pass them as environment variables.

### macOS

Without a certificate the app is ad-hoc signed (`"signingIdentity": "-"` in `tauri.conf.json`) and not notarised. A downloaded copy opens after one attempt and then System Settings → Privacy & Security → **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/ViscosityCode.app`.

To sign with a Developer ID certificate, set these and add `--config '{"bundle":{"macOS":{"signingIdentity":null}}}'` to the build (Tauri refuses an imported certificate that does not match the `-` identity):

| Variable                     | What it is                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | "Developer ID Application" certificate as a base64 `.p12`     |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` password                                           |
| `APPLE_ID`                   | Apple ID for notarisation (notarisation runs only with all 3) |
| `APPLE_PASSWORD`             | An app-specific password for that Apple ID                    |
| `APPLE_TEAM_ID`              | Your 10-character Apple team ID                               |

The signed and notarised path is untested. The bundled host contains its own Mach-O files (`standalone/runtime/node`, native `.node` modules, the node-pty `spawn-helper`); notarisation will likely need them signed with the hardened runtime and Node's JIT entitlements first.

### Windows

Unsigned by default; on the SmartScreen prompt, click **More info** → **Run anyway**. To sign with a `.pfx`, import it into the certificate store and pass its thumbprint: `--config '{"bundle":{"windows":{"certificateThumbprint":"<thumbprint>","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com"}}}'`. Azure Trusted Signing is not wired into the Tauri build yet (it needs a `bundle.windows.signCommand`).

## GitHub Actions

[`.github/workflows/viscosity-desktop.yml`](.github/workflows/viscosity-desktop.yml) runs the repo's `_server-artifact.yml` to build and qualify the standalone host archives, then one Tauri job per target (macOS arm64 on `macos-15`, macOS x64 on `macos-15-intel`, Windows x64 on `windows-latest`). Each job runs `cargo test`, stages its target's archive, builds with `@tauri-apps/cli` 2.12.4, smoke-tests the Mac bundles headlessly and uploads the installer.

- **Run it by hand:** Actions → **ViscosityCode desktop** → **Run workflow**, optionally with a version to stamp. The installers appear under the run's **Artifacts** (`viscositycode-macos-arm64`, `viscositycode-macos-x64`, `viscositycode-windows-x64`).
- **Release from a tag:** push a tag such as `v1.2.3`; the installers are attached to a **draft** GitHub release for you to review and publish. Its notes warn that the app cannot open a data folder created by the Electron app yet.
- **A leg failed:** **Re-run failed jobs** reuses the standalone archives the server job already uploaded (kept 5 days), so it does not rebuild them.

Signing is optional. These repository secrets (Settings → Secrets and variables → Actions) are used when present and reach only the packaging step, as environment variables: `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` (become `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (becomes `APPLE_PASSWORD`), `APPLE_TEAM_ID`, and `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (a base64 `.pfx`). The `AZURE_*` secrets are no longer used.

The workflow never sends telemetry keys, crash reports, or anything to Poracode's servers.

## Troubleshooting

- **"The ViscosityCode server is missing"** in the app window: the bundle was built without `--config tauri.bundle.conf.json`, or nothing was staged. Run `bun run tauri:stage`, then `bun run tauri:build`.
- **The app shows an error page about the data folder's credential key** ("Credential mode change requires explicit activation"): the data folder was created by the Electron app, which sealed its key with the macOS keychain. The Tauri app cannot use such a folder yet and changes nothing in it (release gap 2 in [`desktop-tauri/README.md`](desktop-tauri/README.md#release-gaps-owner-decisions-needed-before-a-public-release)).
- **Tauri warns that the identifier ends with `.app`:** expected; `com.viscositycode.app` is kept on purpose so the app replaces an installed Electron copy.
- **Out-of-date native modules after switching Node versions:** `bun install --force`.
