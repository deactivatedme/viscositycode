# Building ViscosityCode

This guide covers making the desktop installers: a DMG for macOS (Apple silicon and Intel) and an NSIS installer for Windows (x64 and Arm64). For day-to-day development (`bun run dev`, checks, tests), see [AGENTS.md](AGENTS.md).

## What you get

| Platform | Installer                                         | Where it can be built           |
| -------- | ------------------------------------------------- | ------------------------------- |
| macOS    | `release/ViscosityCode-<version>-arm64.dmg`       | a Mac, or GitHub Actions        |
| macOS    | `release/ViscosityCode-<version>-x64.dmg`         | a Mac, or GitHub Actions        |
| Windows  | `release/ViscosityCode-Setup-<version>-x64.exe`   | a Windows PC, or GitHub Actions |
| Windows  | `release/ViscosityCode-Setup-<version>-arm64.exe` | a Windows PC, or GitHub Actions |

Windows installers can't be built on a Mac: the terminal backend (`node-pty`), SQLite, and the Windows process helper are native Windows code that has to be compiled and checked on Windows. Use a Windows PC or the GitHub Actions workflow below.

## Tools

- **Bun**, the exact version in `package.json` (`packageManager`). On Windows, run scripts through `node scripts/setup-bun.mjs --run run <script>`.
- **Node.js 26.13.0** or newer.
- **Rust 1.98.1** (via [rustup](https://rustup.rs)) for the small native helpers. On a Mac it's optional for a personal build (see [Building without Rust](#building-without-rust)); on Windows it's required, because the terminal process helper is compiled with Rust during the build.
  - macOS: `rustup target add x86_64-apple-darwin aarch64-apple-darwin`
  - Windows: `rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc`
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Visual Studio Build Tools with the "Desktop development with C++" workload, plus Git for Windows (for `bash`).

## Build on a Mac

```sh
bun install
bun run dist:mac          # DMG + update ZIP for both Apple silicon and Intel
```

Narrower builds:

```sh
bun run dist:mac:arm                                                       # Apple silicon DMG only
node scripts/build-desktop-artifact.mjs --platform mac --target dmg        # both DMGs, no ZIPs
node scripts/build-desktop-artifact.mjs --platform mac --target dmg --arch x64   # Intel DMG only
```

The script builds the app, prepares the native helpers, stages a clean copy, and runs electron-builder. Installers land in `release/`.

## Build on Windows

```powershell
node scripts/setup-bun.mjs --run install
node scripts/setup-bun.mjs --run run dist:win       # x64 installer
node scripts/setup-bun.mjs --run run dist:win:all   # x64 and Arm64 installers
```

Windows installers also carry a Linux helper for projects inside WSL. Build it on Linux or WSL first (install `musl-tools`, run `rustup target add x86_64-unknown-linux-musl`, then `node scripts/prepare-mcp-relay.mjs --platform linux --require`) and copy `resources/wsl-helpers/mcp-relay/linux-x64/` into the Windows checkout, or let GitHub Actions do it for you.

## Building without Rust

This applies to macOS builds only. Packaging stops when a native helper is missing. Each helper has a JavaScript fallback, so a personal build can skip them:

```sh
PORACODE_ALLOW_MISSING_COMPUTER_USE_HELPER=1 \
PORACODE_ALLOW_MISSING_MCP_RELAY=1 \
PORACODE_ALLOW_MISSING_GIT_HELPER=1 \
CSC_IDENTITY_AUTO_DISCOVERY=false \
bun run dist:mac:arm
```

What changes: computer use falls back to the older foreground driver, MCP servers launch through the JavaScript relay, and Git status and project search use the TypeScript code path. Everything still works; it's a little slower. Release builds should include the helpers.

`dist:mac*` also skips the prebuilt SSH runtime archive that release builds ship; without it the app assembles the runtime itself the first time you connect to an SSH host. To include it, run `bun run build`, `bun run prepare:package-assets` and `node scripts/build-ssh-runtime-archive.mjs`, then package with `node scripts/build-desktop-artifact.mjs --platform mac --target dmg --skip-build`.

## Signing and notarisation

Unsigned installers run, but macOS and Windows warn people first. To sign, set these **environment variables** (never put certificates or passwords in files that get committed):

### macOS

| Variable                      | What it is                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `CSC_LINK`                    | Your "Developer ID Application" certificate as a base64 `.p12`, or a path to it       |
| `CSC_KEY_PASSWORD`            | The `.p12` password                                                                   |
| `APPLE_ID`                    | Apple ID used for notarisation                                                        |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID`               | Your 10-character Apple team ID                                                       |
| `PORACODE_LCU_TEAM_ID`        | The same team ID; pins the locked computer-use plug-in to your signature              |

If the certificate is already in your login keychain, electron-builder finds it without `CSC_LINK`. Notarisation runs only when the three `APPLE_*` values are set. Instead of an Apple ID you can use an App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).

**Unsigned macOS builds:** set `CSC_IDENTITY_AUTO_DISCOVERY=false` and leave `CSC_LINK`/`CSC_NAME` unset. The app is then ad-hoc signed as a whole, so a downloaded copy opens with right-click → Open instead of being reported as "damaged". Without that variable, a Mac with no certificate ships the Electron binaries' leftover signatures, which macOS rejects once the DMG has been downloaded. The GitHub workflow does this for you when no certificate secret is set.

### Windows

| Variable               | What it is                                                        |
| ---------------------- | ----------------------------------------------------------------- |
| `WIN_CSC_LINK`         | Your code-signing certificate as a base64 `.pfx`, or a path to it |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` password                                               |

To turn a certificate into base64 for an environment variable or a GitHub secret:

```sh
base64 -i certificate.p12 | pbcopy            # macOS
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard   # Windows
```

### Opening an unsigned build

- **macOS:** right-click the app in Applications → **Open** → **Open** (on newer macOS: try to open it once, then System Settings → Privacy & Security → **Open Anyway**). Or run `xattr -dr com.apple.quarantine /Applications/ViscosityCode.app`.
- **Windows:** on the SmartScreen prompt, click **More info** → **Run anyway**.

## GitHub Actions

[`.github/workflows/viscosity-desktop.yml`](.github/workflows/viscosity-desktop.yml) builds both DMGs and both Windows installers on GitHub's Mac and Windows machines.

- **Run it by hand:** Actions → **ViscosityCode desktop** → **Run workflow**. You can stamp a version and pick the stable or nightly channel. The installers appear under the run's **Artifacts**.
- **Release from a tag:** push a tag such as `v1.2.3`; the workflow builds everything and attaches the installers to a **draft** GitHub release for you to review and publish.

Signing is optional. Add any of these as repository secrets (Settings → Secrets and variables → Actions) and the workflow uses them; leave them out for unsigned builds:

`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

The workflow never sends telemetry keys, crash reports, or anything to Poracode's servers.

## Options

| Variable                    | Effect                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `PORACODE_CHANNEL=nightly`  | Builds "ViscosityCode Nightly" (separate app ID, data folder, amber icon) beside the stable app   |
| `VISCOSITYCODE_UPDATE_REPO` | `owner/repo` of your own GitHub repository to enable in-app updates; unset means no update checks |
| `PORACODE_SOURCEMAPS=1`     | Also writes source maps (for debugging a packaged build)                                          |

The `PORACODE_*` names come from the upstream build scripts and are kept as-is so upstream changes merge cleanly; they don't appear anywhere in the app.

## Troubleshooting

- **"requires the staged locked computer use plug-in"** (macOS): run `node scripts/prepare-locked-computer-use.mjs`, or use `bun run dist:mac*`, which does it for you.
- **"Windows packaging requires a runtime built with the prepared PTY job owner"**: rebuild on Windows (`bun run build`) before packaging; the helper is compiled during the build.
- **"is damaged and can't be opened"** on macOS: the build was packaged without a signature at all. Rebuild with `CSC_IDENTITY_AUTO_DISCOVERY=false` (see [Signing and notarisation](#signing-and-notarisation)) or, for a copy you trust, run `xattr -dr com.apple.quarantine /Applications/ViscosityCode.app`.
- **Out-of-date native modules after switching Node versions:** `bun install --force`.
