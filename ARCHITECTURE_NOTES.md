# ViscosityCode — Architecture Notes

These notes explain how the Poracode code base (which ViscosityCode is forked from) is put together, in plain language, so we can change the look and feel without breaking the engine underneath. Every claim below was checked against the source at upstream commit `9b62823d5` (Poracode `master`, 17 Nov 2026). Paths are relative to the repository root.

> **Short version.** Poracode is not one program. It is a handful of cooperating processes. The window you see (the _renderer_) is a React app that only _displays_ state. Agents are started and owned by a separate _supervisor_ process, and their state reaches the window through a local, authenticated WebSocket. That separation is what lets us rebuild the UI and add visual effects without touching the agent engine: the effects only _read_ state that the window already receives.

---

## 1. Processes: who owns what

| Process                           | Source                                                                         | Built file                  | What it owns                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Electron main**                 | `src/main/main.ts`                                                             | `dist/main/main.cjs`        | Windows, tray, menus, OS dialogs, auto-updater, notifications, the "one owner per data folder" lease, and starting the backend. Only `src/main/` is allowed to import `electron`. |
| **Preload bridge**                | `src/main/preload.ts`                                                          | `dist/main/preload.cjs`     | A small, sandboxed API exposed to the window as `window.poracodeHost` (via `contextBridge`). Startup facts plus a few shell operations.                                           |
| **Backend host** (child of main)  | `src/backend/index.ts`                                                         | `dist/main/backendHost.cjs` | The SQLite database, settings, schedules, PR watching, and a loopback HTTP/WebSocket server (`RemoteAccessServer`) that the window talks to.                                      |
| **Supervisor** (child of backend) | `src/supervisor/index.ts`                                                      | `dist/main/supervisor.cjs`  | **The only process that starts agents.** Runs provider SDKs, ACP sessions, terminal CLIs on real PTYs, Git, and MCP servers.                                                      |
| **Renderer** (the window)         | `src/renderer/` (entry `index.html` → `bootstrap.ts` → `main.tsx` → `app.tsx`) | `dist/renderer/`            | React 19 + HeroUI v3 + Tailwind 4 + xterm.js + Monaco + Zustand. Pure presentation.                                                                                               |
| **Standalone server**             | `src/server/cli.ts` (`poracode serve`)                                         | `dist/main/server.cjs`      | The same backend + supervisor without Electron, for headless or remote use.                                                                                                       |

Rules the code enforces (and we must keep):

- **Only the supervisor spawns agent processes.** The renderer can be reloaded, remote, or a phone, so it never owns a process.
- **One owner per data folder.** A lease file stops two apps from writing the same data at once. This is why ViscosityCode needs its _own_ data folder (see §8), otherwise it would fight a real Poracode install.
- **Shared code is provider-agnostic.** Each agent (Claude, Codex, Grok, …) is a plugin folder; shared UI never says `if (agent === "claude")`.

The same renderer bundle is also built as a **web/PWA client** (`PORACODE_BUILD_TARGET=web`) and a **Chrome extension** side panel. Anything we change in shared React components shows up there too, so desktop-only chrome is gated behind "is this the desktop app with native window chrome".

## 2. The IPC boundary (how the window talks to the engine)

There are two channels, and almost all agent traffic uses the second one:

1. **Preload IPC (Electron).** `window.poracodeHost` exposes static facts (platform, window kind, capabilities), window controls, notifications, and one generic `invokeProcedure(envelope)` call on the IPC channel `poracode:client-procedure-invoke`. Main checks the envelope version and either answers locally (`src/main/ipc/localHandlers.ts`) or forwards to the backend. Every procedure is declared once, with a Zod schema, in `src/shared/ipc/procedureMap.ts` and `src/shared/ipc/procedures/*`. Channel names live in `src/shared/ipc/channels.ts`.
2. **Loopback HTTP + WebSocket (the data plane).** At startup the renderer asks main for a pinned `127.0.0.1` endpoint and pairing token, then installs `ManagedElectronHostTransport` (`src/renderer/clientRuntime.ts`). Thread and agent calls go over HTTP; **live events stream over a WebSocket** that runs in a Web Worker. Preload IPC deliberately refuses to carry this traffic.

Web, PWA and the native iOS/Android apps use the same HTTP/WebSocket contract remotely (`src/shared/remote/contract/`, generated into `protocol/remote/v3/`). The versions of these boundaries are pinned (`CLIENT_HOST_HOP_VERSION` in `src/shared/clientHostHop.ts`, remote protocol v14). **The fork changes none of them.**

**How live agent state lands in the window.** Every supervisor event goes through one reducer, `supervisorEventReducer` (`src/renderer/state/remote/reducers/supervisorEventReducer.ts`), into one Zustand store, `useAppStore` (`src/renderer/state/appStore.ts`). The store is created with `subscribeWithSelector`, so code _outside React_ can subscribe to tiny slices cheaply. That is the hook point for our visual effects (§5).

## 3. Agents, ACP and sessions (the part we treat as a library)

- **Provider plugins.** Each agent has an adapter in `src/supervisor/agents/<kind>/` (registered in `src/supervisor/agents/registry.ts`, contract `AgentAdapter` in `src/supervisor/agents/base/types.ts`) and a UI half in `src/renderer/components/providers/<kind>/`.
- **Two presentations per thread** (`presentationMode` in `src/shared/contracts/common.ts`):
  - `terminal`: a real PTY running the agent's CLI, drawn with xterm.js.
  - `gui`: a structured runtime drawn as native chat.
- **ACP is one of several structured transports.** ACP sessions run through `@agentclientprotocol/sdk` (`src/supervisor/agents/acp/session.ts`, class `AcpStructuredSession`). Claude uses the Claude Agent SDK, Codex its app-server, OpenCode an SDK sidecar, Pi an RPC session, Cursor an SDK session. **All of them are normalised into one vocabulary, `RuntimeEvent`** (`src/shared/contracts/runtimeEvent.ts`). That vocabulary, not ACP itself, is the boundary the UI reads.
- **Session manager.** `ThreadSessionManager` (`src/supervisor/runtime/threadSessionManager.ts`) owns live sessions; `threadOutputPipeline.ts` derives each thread's status.
- **MCP.** Supervisor-owned servers in `src/supervisor/mcp/`; agent-to-agent delegation in `src/supervisor/crossagentMcp/`.
- **Git and worktrees.** `src/supervisor/git.ts`, `src/supervisor/git/worktreeService.ts` (plain `git` via `execFile`).
- **Persistence.** SQLite via `better-sqlite3`; schema and migrations in `src/host/db/connection.ts` (tables such as `threads`, `thread_runtime_items`, `thread_completed_turns`, `thread_terminal_scrollback`).

**Agent states the UI can already read** (all in `useAppStore`):

| Visual state                      | Existing data                                                                                                              | Chat threads | Terminal threads                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------- |
| Any status                        | `thread.status` ∈ `inactive, launching, working, idle, finished, needs_approval, needs_reply, error`; `thread.attention`   | ✓            | ✓ (from CLI hooks or terminal parsing) |
| Thinking                          | a `reasoning` item whose `state !== "completed"` in `runtimeItemsByIdByThread`                                             | ✓            | —                                      |
| Streaming                         | `item.streams.assistant_text` (and others) grow on every `content.delta`; no rate is stored, so we sample length over time | ✓            | raw PTY bytes only                     |
| Tool running                      | items of type `tool_call`, `mcp_tool_call`, `command_execution`, `file_change`, … with status `running`                    | ✓            | —                                      |
| Waiting for approval / a question | `runtimeRequestsByThread[threadId]` + status `needs_approval` / `needs_reply`                                              | ✓            | status only                            |
| Error                             | status/attention `error`, `thread.errorMessage`, `thread.interruptedTurn === "error"`                                      | ✓            | ✓                                      |
| Finished                          | turn-active → idle transition (`isThreadTurnActive`), `lastTurnEndedAt`                                                    | ✓            | ✓                                      |

Notifications are already decided by the _host_ (`src/host/remote/ThreadNotificationPublisher.ts`) and shown by the window (`src/renderer/notifications.ts`: OS notification when unfocused, toast otherwise, optional sound). The fork reuses this and must not double-notify.

## 4. How threads, panes and layouts are drawn

```
MainView                          src/renderer/views/MainView/MainView.tsx
 ├─ DeferredCommandPalette        (Cmd/Ctrl+K, Cmd/Ctrl+Shift+P, Cmd/Ctrl+G — already exists)
 ├─ MainPageLayout → PageLayout → AppShell   (views/MainView/parts/AppShell/AppShell.tsx)
 │    ├─ left <aside> Sidebar     projects → worktrees → threads; 48px icon rail when collapsed
 │    ├─ content column           optional 32px title row + <main>
 │    │    └─ AppContent          the center: a recursive split-pane tree (SplitPaneContainer)
 │    │         └─ ThreadPane → ThreadView → GuiThreadContent | TerminalThreadContent
 │    │                                       └─ ThreadComposerSection (composer docked at bottom)
 │    ├─ right panel slot         tabs: files, git, terminal, browser, usage, notes, …
 │    └─ git panel slot
 └─ AppOverlays                   Settings, git review, PRs, full-screen editor, dialogs
```

- The center is **split panes, not tabs** (`src/shared/paneLayout.ts`, persisted in `appStore`).
- Chat transcripts are virtualised (`@legendapp/list`); code blocks use Shiki; diffs use `@git-diff-view/react`.
- Terminals are **xterm.js 6.1 beta** with the WebGL addon (`src/renderer/components/terminal/XTermSurface.tsx`).
- A **Monaco editor exists** (`monaco-editor` 0.56) as a panel over `<main>` or a full-screen overlay (`src/renderer/views/FileEditorOverlay/`), with its own file tabs, LSP, diff gutter and merge-conflict lenses.
- There is **no permanent activity bar** and **no status bar**.
- Phone-sized windows (≤ 767 px) switch to a compact layout using the same components (`useCompactLayout()`).

## 5. Where theming and styles live today

- **CSS pipeline.** Tailwind 4 through `@tailwindcss/vite`; entry `src/renderer/tailwind.css` → `herouiStyles.css` (HeroUI 3 component styles) → `styles.css` (one ~8,000-line global stylesheet).
- **Tokens.** `styles.css` `@layer base` redefines HeroUI's variables (`--background`, `--foreground`, `--surface`, `--accent`, `--border`, …) for light and dark, plus app tokens (`--content-background`, `--sidebar-background`, `--composer-surface`, …). `<html>` carries both `class="dark|light"` and `data-theme`, plus `data-theme-preset`.
- **A theme system already exists:** `src/renderer/theme/themePresets.ts` (13 presets written as a few hex "anchor" colours), `themeTokens.ts` (derives 24 CSS variables from the anchors), `applyAppTheme.ts` (writes them on `<html>`), and **versioned custom themes with JSON import/export** (`src/shared/customThemes.ts`, Settings → Appearance).
- **Not themed today:** the 16 ANSI terminal colours and the terminal selection colour, Monaco widget colours (light/dark only), Shiki code-block themes (GitHub light/dark), and ~85 hard-coded colours in TS/TSX plus ~128 in `styles.css` outside the token block.
- **Motion.** ~41 `@keyframes`; a shared animation clock (`src/renderer/thinkingAnimator.ts`: 20 fps, 5 fps unfocused, paused when hidden, honours reduced motion); `<html data-app-hidden data-app-unfocused>` from `uiAnimationActivity.ts`.
- **Window chrome** (`src/main/window/createMainWindow.ts`):
  - macOS: `titleBarStyle: "hiddenInset"`, transparent window, `vibrancy: "sidebar"`.
  - Windows/Linux: `titleBarStyle: "hidden"` + `titleBarOverlay`, so Windows draws the real minimise/maximise/close buttons (Snap Layouts included). Acrylic material on Windows 11 22H2+ when translucency is on; Mica is never used.
  - Live colour updates go through the `setWindowChrome` IPC (`src/main/ipc/localHandlers.ts`).
- **Fonts.** Geist and Geist Mono (SIL Open Font License) bundled in `src/renderer/fonts/`.
- **Theme settings are host settings** (`src/shared/settings.ts`: `themeMode`, `themePreset`, `customThemes`), saved by the backend to `settings.json` and shared with every connected client.

## 6. Builds, packaging and signing

- **Build tools.** Vite 8 for the renderer; tsdown for main/preload/backend/supervisor/server (all CommonJS for Node). Turbo caches checks. Package manager: Bun (pinned canary in `package.json#devDependencies.bun`); Node 26.13.0.
- **Packaging.** There is no static electron-builder file. `bun run dist` runs `scripts/build-desktop-artifact.mjs`, which stages the app and **generates** `electron-builder.yml` (`buildElectronBuilderConfig()`), then runs electron-builder.
  - Channel values (product name, app ID, data folder, artefact prefix, mac executable name) live in two copies that a test keeps in sync: `scripts/electron-builder.shared.cjs` and `src/shared/channel.ts`.
  - **macOS:** DMG + ZIP, x64 and arm64 built separately, minimum macOS 13, hardened runtime, entitlements in `build/entitlements.mac.plist`, notarisation on. The ZIP pass keeps the legacy "Lightcode" executable name for old auto-updates.
  - **Windows:** NSIS, x64 + arm64, per-user, with `build/desktop-cli.nsh` adding the CLI to `PATH`.
  - **Linux:** AppImage + deb (x64).
- **Signing.** macOS uses electron-builder's standard env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). **Windows is not signed upstream** (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI; `build/signing.yml` is unused), but electron-builder will sign NSIS from `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` with no config change.
- **Rust helpers** (`native/`): `computer-use-helper`, `mcp-relay`, `git-helper` (optional in dev, with JS fallbacks; **required** by `dist` unless `PORACODE_ALLOW_MISSING_*=1`); `pty-job-owner` is **required on Windows even for `bun run dev`**.
- **CI.** `.github/workflows/_build.yml` (matrix: `windows-latest`, `ubuntu-latest`, two `macos-15` legs), called by `release.yml` / `release-nightly.yml` (manual trigger).

## 7. Things the brief assumed that are different in reality

| The brief assumed                                                              | What Poracode actually has                                                                                      | What the fork does                                                                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Agents run "over ACP"                                                          | ACP is one of ~6 structured transports, all normalised into `RuntimeEvent`; plus real PTYs                      | Effects read `RuntimeEvent`-derived store state, never ACP directly                                      |
| Need a token theme system + JSON import/export                                 | Already exists (13 presets, versioned JSON)                                                                     | Extend it: add fork tokens (radii, spacing, fonts, shadows, motion, effects) and 3 ViscosityCode presets |
| Need a command palette on Cmd/Ctrl+K and Cmd/Ctrl+Shift+P                      | Already exists with exactly those shortcuts                                                                     | Restyle it                                                                                               |
| Composer must be docked at the bottom of each pane                             | Already is, for chat and terminal threads                                                                       | Restyle it                                                                                               |
| Monaco "if it exists"                                                          | Exists (overlay/panel with its own tabs)                                                                        | Theme it from tokens; surface it as a center tab                                                         |
| Need macOS hidden-inset + vibrancy, Windows custom title bar with snap layouts | Already there (Windows uses the OS-drawn caption buttons, which keep Snap Layouts)                              | Keep the native buttons; add Mica, theme-coloured startup background                                     |
| Center area is tabs                                                            | It is a split-pane tree                                                                                         | Add a tab strip on top of it (no change to saved layouts)                                                |
| A single "user data folder"                                                    | Several: `~/.poracode` host data + siblings, Electron `userData`, keychain identity "Lightcode", CLI install, … | Rename the ones that would collide with a real Poracode install                                          |
| App ID is Poracode's                                                           | It is the legacy `com.lightcode.app`                                                                            | New ID `com.viscositycode.app`                                                                           |
| Poracode "phones home" only via updates                                        | Also news feed, changelog, feedback form, push gateway, pairing web app                                         | Disable or repoint all of them                                                                           |

## 8. Fork decisions (made without stopping, per the owner's instruction)

1. **Name and identity.**
   - Product name `ViscosityCode` (nightly `ViscosityCode Nightly`).
   - App ID `com.viscositycode.app` (`.nightly`).
   - Host data folder `~/.viscositycode` (`-nightly`, `-dev`).
   - Electron data folder `…/Application Support/ViscosityCode` (or `%APPDATA%\ViscosityCode`).
   - Desktop CLI command `viscositycode`.
   - No "Lightcode" keychain or Dock-tile bridging, because the fork has no old installs to migrate.
2. **What stays named "poracode" on purpose.** Internal identifiers that are compatibility boundaries or merge hotspots: `PORACODE_*` environment variables, `poracode-*` CSS classes and storage keys, IPC channel names, protocol schemas, project-level `.poracode/` folders inside repositories, and hook file names. Users do not see these as branding, and renaming them would break upstream merges and paired clients.
3. **User-facing text.** Lingui catalogs are left untouched. The renderer substitutes the product name when a catalog loads (one small wrapper in `src/renderer/i18n/`). Every existing and future upstream string therefore says "ViscosityCode" with no `.po` merge conflicts. A test enforces it. Main-process strings, HTML title, PWA manifest, tray and installer strings are edited directly. Upstream-specific promotions (GitHub stars, "Poracode on X", the remote news feed) are switched off.
4. **No phoning home to Poracode.** Auto-update and CLI self-update point at the fork's own GitHub repo when configured through environment variables, and are off otherwise. News, changelog, feedback and the push gateway are disabled by default. The hosted pairing web app origins are removed.
5. **Fork code lives in its own folders.** `src/renderer/viscosity/` holds layout pieces (activity bar, tab strip, status bar, bots), `src/renderer/fx/` holds the background and reactive effects, and `src/renderer/theme/viscosity/` holds tokens and presets. Upstream files get small, clearly marked hook-in edits (`// ViscosityCode:` comments) so merges stay easy.
6. **Fork preferences are client settings** (stored in the browser's local storage), not host settings. Background preset, intensity, blur and effect toggles are view preferences. Keeping them client-side avoids changing the host settings schema that phones and other clients share.
7. **Effects are read-only and off the hot path.** They subscribe to `useAppStore` _outside React_ and drive CSS variables and data attributes, or the WebGL loop, directly. Typing, scrolling and terminals never wait on them.
8. **Bots section, Codync-style, built on our own engine.** Bots are persistent, named AI teammates, the same idea as the open-source Codync app. Each bot has:
   - a name, an avatar and an accent colour;
   - standing instructions;
   - its own "brain";
   - a workspace project;
   - a short memory note;
   - one ongoing chat.

   Group chats hold several bots; you @mention who should answer, and they reply in turn.

   A bot's brain is either one of the coding agents ViscosityCode already runs (Claude Code, Codex, Grok Build, Gemini, … through the existing thread engine, so approvals and tools work as usual) or a **Grok model on the xAI API**. The xAI path follows the owner-confirmed spec:
   - Responses API, `POST https://api.x.ai/v1/responses`, with `input`;
   - model `grok-4.7`, with the server-side `web_search` and `x_search` tools;
   - images from `grok-imagine-image-2.0`;
   - an optional US regional endpoint, `https://us.api.x.ai/v1`, for text only;
   - the key from `XAI_API_KEY`, or one you paste in, kept with OS-encrypted storage.

   xAI requests run in the Electron main process behind a fork-owned preload namespace, so the key never sits in page code and the agent engine's IPC procedure map is unchanged. **Grok Bot (x.ai/bot) is deliberately not included:** it has no developer API.

9. **Scope of clients.** The fork targets the desktop app (macOS, Windows). The phone-sized/PWA layout keeps working but is not restyled, and the native iOS/Android apps are untouched.

## 9. Baseline health before any change (upstream `9b62823d5`, macOS arm64, 8 GB RAM)

| Check                                              | Result                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `bun install`                                      | OK (1,156 packages, 42 s)                                                   |
| Format, lint, typecheck (`bun run checks --force`) | All pass (8,920 files type-checked)                                         |
| Unit tests (`bun run test`)                        | 2,769 / 2,790 files pass; 34,290 tests pass, 15 fail, 145 skipped (~21 min) |
| Dev app (isolated mock profile)                    | Boots and renders; screenshots in `tmp/shots/step1/`                        |

The 15 test failures are all **pre-existing or caused by this machine**, not by the fork:

- **12 fail because of a macOS temp-folder quirk.** The temp folder `/var/folders/…` is a symlink to `/private/var/folders/…`, and a strict "real path" check in those tests rejects it. They pass with `TMPDIR="$(cd "$TMPDIR" && pwd -P)/"`.
- **1 needs Java.** The Kotlin wire-format test runs the Android Gradle build, and Java is not installed on this Mac.
- **1 timed out under full-suite load.** `protocol/remote/v3/binding-format.test.ts` passes when run alone.
- **1 fails on upstream as-is.** `src/supervisor/agents/claude/sdkSession.browser.test.ts › streams a reply while initial MCP connection is still pending` is an upstream bug.

Tools installed for this machine: Node 26.13.0 in `~/.local/node-v26.13.0`, and the pinned Bun in `~/.local/bin/bun`. Rust is not installed: `bun run dev` falls back to JavaScript helpers, and packaging uses the documented `PORACODE_ALLOW_MISSING_*` switches (see BUILDING.md).
