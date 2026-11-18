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

### Step 5 features

Ten features added in Step 5 (18 Nov 2026). For each one: where the code lives, how it plugs in, what it saves, and what to remember. FORK_CHANGES.md has the full file list. None of them has been checked in the running app yet; they are covered only by unit and jsdom tests.

**Rules all ten follow**

- **Desktop shell only.** Chrome, panels and commands check `html[data-vc-shell]` (`isViscosityShellActive()`, `useViscosityShellEnabled()`). Outside the shell, commands stay registered so saved keybindings still resolve, but they are hidden from the palette and Shortcuts and `run()` does nothing. The compact/PWA layout, the extension side panel and the native iOS/Android apps are unchanged. Exceptions: "Share theme" and the theme commands work in every client.
- **Never steals focus.** Panels open only on a user action (activity bar, palette, status bar, a button). Agent activity never brings a panel forward, switches the view or raises the window.
- **View preferences live in localStorage** (decision 6). Every key ends in `:v1`, every read and write sits in try/catch, and a missing, malformed or foreign-version document gives defaults. Only account pools add a field to the host settings schema (theme commands and theme import write existing host settings).
- **Nothing re-renders on streaming deltas.** Live values (Mission Control's current step, the project in focus, agent transitions) are read outside React with narrow selectors, or sampled.
- **Provider-agnostic.** Providers are identified by agent kind (`baseAgentKind`; profile kinds are `<driver>:<id>`), never by name.
- **Register on import.** A feature's `index.ts` registers its activity/status bar items, Mission Control tabs and commands once (idempotent) when it is imported. Something must import it at startup, or the feature does not exist at runtime.
- **Commands** use `registerViscosityCommands(key, factory)`. Upstream `src/renderer/commands/registry.ts` spreads `...viscosityCommands()` (one marked line), so registered commands reach the palette and Settings → Shortcuts.

**What Step 5 saves**

| Key or field                                                                   | Feature              | Where                                       | Versioning notes                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | -------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viscosity:mission-control:v1`                                                 | Mission Control      | localStorage                                | `{ tabId, filter }`. Version is only in the key name. Bad values fall back to defaults; a tab id must match `/^[a-z0-9][a-z0-9._:-]{0,63}$/i`.                                                                                                                              |
| `viscosity:smartStart:v1`                                                      | Smart start          | localStorage                                | `version: 1`, checked on read. `autoByProject` (max 500 projects), `preferences` per task kind, `recentProviders` (max 16).                                                                                                                                                 |
| `viscosity:agent-colors:v1`                                                    | Agent colours        | localStorage                                | `version: 1`. Stores only the toggle and the owner's picks (max 256); default colours are derived, never saved.                                                                                                                                                             |
| `viscosity:fx:v1` → `sounds`, `projectBackgrounds`                             | Sounds, backgrounds  | localStorage                                | Still version 1: both groups are additive, and a version 1 document from before Step 5 loads with their defaults. Overrides capped at 200 (least recently edited dropped first); unsafe keys such as `__proto__` are dropped.                                               |
| `poracode-viscosity-roundtables` → `pattern: "compare"`, `seededFromSessionId` | Ask all models       | backend key/value state (`createDbStorage`) | Still version 1, additive. An older build drops compare records one by one on load and loses them on its next write. Accepted: only compare sessions are lost on a downgrade.                                                                                               |
| `accountPools[*].excludedMembers`                                              | Account pools        | host `settings.json`                        | `ACCOUNT_POOLS_VERSION` 2 (informational). No `SETTINGS_DOCUMENT_VERSION` bump: the key is optional and never added to untouched pools. Audit in the doc comment in `src/shared/accountPools.ts`; pre-upgrade tests in `src/backend/settings/accountPoolsSettings.test.ts`. |
| Zen on/off, Mission Control open/closed                                        | Zen, Mission Control | not saved                                   | Per window; a restart starts with both off.                                                                                                                                                                                                                                 |

Command ids are saved too, in users' `keybindings.json` and feature-usage signals, so they must never change once released (see Palette commands).

#### Mission Control

- **Code:** `src/renderer/viscosity/missionControl/`. Feature entry `index.ts`.
- **What it is:** a center panel over the split view (like the Roundtable and bot chat panels), with tabs. The built-in "Agents" tab is a card grid of every active or recently finished thread across all projects (last 2 hours), every live Roundtable (one card in place of its participant threads) and every bot with a chat. Order: needs you, errors, working, done. Filters: All / Needs you / Working / Errors / Done.
- **Mounts and registers:** `ViscosityCenterFrame.tsx` imports the entry and renders `<MissionControlHost />` after `<BotChatPanelHost />`. Registers the tab `agents` (order 0), activity item `mission-control` (order 110, badge = how many need you), status item `mission-control` (order 230, "N need you") and command `missionControl.open`.
- **Extension points other features use:** `registerMissionControlTab({ id, label, order, component })` in `tabs.ts`, and `openMissionControl({ tabId?, filter? })` in `missionControlViewStore.ts`. Subscriptions depends on both; keep them stable.
- **Relies on:** it opens only on a user action and closes when the user opens a thread, the editor, a Roundtable or a bot chat, or presses Escape (only when focus is inside and nothing else handled the key). "Review request" only brings the waiting thread forward; it never approves. The current-step tracker samples about once a second, only for mounted cards, only while the window is visible. When a finished comparison and the debate seeded from it share a thread, the live session owns it (`participantOwners`), so it is counted once.
- **Limits:**
  - Current step and Stop work only for GUI threads loaded in this window; terminal threads show no step and have no Stop.
  - Pooled account and usage left show only for the managed host's pools.
  - `missionSources.ts` reads the Roundtable store and the API bot chat store directly (read-only), because their `api.ts` files do not expose that state yet.
  - A tab id that fails the pattern above can never be selected.
  - The one-second timer clock keeps ticking while the window is hidden.
  - Shrinking to the compact layout, opening a thread, then widening again brings the panel back over the thread (the Roundtable and bot hosts do the same).

#### Subscriptions dashboard

- **Code:** `src/renderer/viscosity/subscriptions/`. Feature entry `index.ts`. No upstream edits.
- **What it is:** a Mission Control tab with one row per provider and nested rows for its accounts (base account plus `<driver>:<id>` profiles; pool members first, in pool order). Each account shows plan, readiness, pool badge, "Out of usage" / "Running low", usage bars with reset countdowns and credits. A "Who has room right now" strip ranks ready accounts by headroom. Refresh runs the usage panel's forced refresh; Sign in runs the existing `runAgentLoginCommand` flow; "Manage pool" opens Settings → Agents → that provider.
- **Registers:** `missionControl/index.ts` imports the entry once (marked side-effect import), which registers tab `subscriptions` (order 10, loads lazily) and command `subscriptions.open`. Subscriptions imports only `missionControl/tabs` and `missionControlViewStore`, so there is no import cycle.
- **Saves:** nothing. It reads the managed host's agent statuses, profiles, account pools and usage snapshots.
- **Relies on:** reuses `UsageWindowBars`, `ProviderUsageCircle`, `UsageCreditsRow`, the usage panel's `hasDisplayableCredits`, and the shared `memberAvailability` (the same rule host failover uses).
- **Limits:**
  - Remote and browser clients get no pool badges, no Manage pool and no terminal sign-in.
  - Before the loopback data plane is up, Refresh quietly does nothing.
  - Readiness uses the first status row per agent kind (native before WSL), so a WSL-only sign-in is not shown separately.
  - Countdowns update once a minute. Accounts with unknown usage appear in neither the "room" nor the "out" list. A snapshot whose refresh failed but kept old windows shows them without a warning.

#### Smart start ("Let ViscosityCode pick")

- **Code:** `src/renderer/viscosity/smartStart/`.
- **What it is:** an "Auto" toggle right before the model picker in the new-thread composer, and a row above the input ("Will use: Provider · Account · Model", "72% left") with Change, "Back to the automatic pick", preferences and "Turn off Auto".
- **Hooks (marked):** `ThreadDraftView.tsx` (import, `useSmartStartDraft`, `decorateControls` around the account-pool control, `viscosityDock` and `onStart={smartStart.wrapStart(onStart)}` props). `ThreadDraftComposerArea.tsx` (optional `viscosityDock` prop rendered in the composer dock). No engine changes.
- **How it picks:**
  - Candidates are the ready agents (same readiness filter as Roundtable), with each pooled account listed on its own.
  - Score = usage headroom from `memberAvailability` with that pool's switch threshold (unknown usage = 50). Accounts out of usage never win.
  - Bonus 15 / 10 / 6 / 3 for the first four entries of the "preferred for coding" or "preferred for quick questions" list. A small regex classifier guesses the task kind from the draft text the composer already saves. A list the owner never edited follows the last-used order.
  - Ties go to the better preference rank, then the model picker's order. The current pick stays unless another scores more than 3 points higher.
  - The pick is applied with `setAgentKind`; that provider's saved default model follows through the existing effect, and Send uses the normal launch path.
- **Saves:** `viscosity:smartStart:v1`.
- **Relies on:** it never hard-codes providers: it ranks only agent kinds the host reports as ready, and the lists hold whatever kinds the owner put there. Desktop shell, local projects only; never isolated drafts (side chat) or drafts on a paired host. Only hand-picked starts feed the last-used order, so Auto does not reinforce itself. Choosing in the model picker while Auto is on overrides it for that draft. With nothing ready, or every account out, nothing is switched and the model picker works as before.
- **Limits:**
  - The task-kind guess is only a nudge.
  - Usage is judged as of when the draft opened (usage pushes still update the pick).
  - A task-kind flip while typing can move the pick; each Auto switch saves the project's last draft selection to the host (the same path account-pool pre-selection uses).
  - The preferences editor (`SmartStartPreferencesEditor`) is only reachable from the Auto row; it is not mounted in Settings yet.
  - The editor can list providers from old threads that are no longer installed (scoring ignores them).

#### Ask all models (Roundtable "compare" pattern)

- **Code:** `src/renderer/viscosity/roundtable/`. New: `engine/compare.ts`, `ui/RoundtableCompareView.tsx`, `ui/compareModel.ts`, `ui/compareActions.ts`, `ui/compareCommands.ts`. Additive edits to `types.ts`, `api.ts`, the store's pattern allow-list, planner, prompts, session, runtime, the setup dialog and `chat/patterns.ts`.
- **What it is:** pattern `compare`. Every participant answers once, in parallel (round 0, phase `answer`). No critique rounds, no verdict. A stopped answer is asked again; a failed one stays failed. The session ends `done` with outcome `compared`, and fails only if nobody answered. The view shows 2 to 5 columns side by side, coloured per agent, scrolled together (outside React).
- **Entry points:** the "Ask all (compare)" card in the Roundtable setup dialog (seats every ready provider, one account each, up to 5), and command `roundtable.askAll` (registered under key `roundtable.compare` from `registerRoundtableChrome`), which opens setup preselected to compare for the focused thread's project and never switches the view.
- **Start a debate from here:** `startDebateFromComparison` starts a debate whose round-0 proposals are the comparison's answers. It reuses the comparison's participant ids, threads and checkout and goes straight to critique. It needs the comparison to have ended and at least two answers, and only one such debate may run at a time per comparison.
- **Saves:** session records in `poracode-viscosity-roundtables` (see table).
- **Relies on:** compare is **answer-only**: it runs in the current checkout with no worktree choice, has no message box, and each prompt says "Do not modify any files in this step." That is an instruction in the prompt, not a sandbox: agents keep their usual approval settings.
- **Limits:**
  - "Continue with this one" inside a split of ordinary threads swaps the thread into the focused pane without `openThread`, so an inactive runtime only reopens when the user sends.
  - A failed answer has no per-column retry, and the session-level Retry does not show once one answer succeeded.
  - Pooled accounts of one provider count as one seat; a Grok seat over the xAI API is not added automatically.
  - A seeded debate's next turn can land in a thread the user is chatting in.
  - The setup dialog seats providers once, from the first non-empty ready list; statuses that arrive late can leave providers out.

#### Per-agent colours

- **Code:** `src/renderer/viscosity/agentColors/`. Public API in `api.ts`.
- **What it is:** each agent kind gets an accent colour: a 2px line on its pane header, a 2px marker on its tab's left edge (and the selected tab's top edge), and a short bar on its sidebar thread rows. Settings → Appearance → "Agent colours": a toggle (on by default), a 13-swatch picker and a reset per installed agent.
- **Mounts:** `index.ts` is an install side effect: it loads the CSS, injects `<style id="vc-agent-colors">` (one rule per known kind defining `--vc-agent-accent`) and toggles `html[data-vc-agent-colors]`. It is imported once from `layout/tabs/ThreadTab.tsx`. Hooks: `ThreadView.tsx` (attribute on the pane root), `ThreadTab.tsx`, and `SortableThreadItem.tsx` (newly modified upstream file: `data-vc-sidebar-thread` plus the attribute). `ViscosityAppearanceExtras.tsx` renders the settings block.
- **For other features:** spread `agentKindAttribute(kind)` (sets `data-vc-agent-kind`) and style with `AGENT_ACCENT_CSS` (`var(--vc-agent-accent, var(--vc-accent))`). Mission Control cards, Subscriptions rows, the Smart start row and compare columns do this. `--vc-agent-accent` stays defined when the toggle is off; the toggle only hides the pane, tab and sidebar markers.
- **Saves:** `viscosity:agent-colors:v1`.
- **Relies on:** default colours come from tiers in `palette.ts` (a 10-colour pool that leaves out the theme accent, red and amber). Profile kinds use their driver's colour unless set. Kinds are hex-escaped in the generated CSS, so a hostile kind cannot leave its selector.
- **Limits:** installing a new agent can move an existing agent's default colour (colours the owner picked never move). More than 10 agents share defaults. Kinds no longer reported by the host fall back to the theme accent. Colours follow light/dark through upstream's `--project-icon-*` tokens but are not tuned per theme preset. No settings-search entries yet. In dev only, editing `runtime.ts` can add a second style tag until reload.

#### Zen mode

- **Code:** `src/renderer/viscosity/zen/`. CSS `zen.css`, imported from `viscosity.css`.
- **What it is:** hides the activity bar, sidebar, status bar, content header and the right and git panels, and centres the center column (up to 1120px). In a split, only the focused pane shows, full size; the others stay mounted. The background canvas drops to 40% opacity and panels become at least 86% opaque. The tab strip waits in a band at the top and fades in when the pointer enters it. An "Exit Zen" pill sits top-right.
- **Mounts and registers:** `ViscosityCenterFrame.tsx` imports `@/renderer/viscosity/zen` (which registers command `viscosity.zen.toggle`, group View) and renders `<ZenModeHost />` after `<MissionControlHost />`, inside the shell-only branch. The host portals into `<body>` and owns the pill, the reveal band and Escape. Attributes: `html[data-vc-zen]`, `html[data-vc-zen-reveal]`, and `data-vc-zen-split` / `data-vc-zen-pane` on the split (updated only when the focused pane or layout changes).
- **Saves:** nothing. A restart starts with zen off, and unmounting the host (for example on switching to the compact layout) turns it off.
- **Relies on:** Escape exits only when no other handler used the key, so terminals, Monaco, popovers, dialogs and menus keep theirs. The pill puts focus back where it was. There is no default key, because changing default keybindings needs a migration (`.agents/docs/versioning.md`); users can bind it in Settings → Shortcuts.
- **Limits:**
  - The right/git panel and floating sidebar backdrop are found by AppShell's DOM shape (child combinators, `.fixed.z-30`), so an upstream AppShell markup change can break zen.
  - A focused draft pane in a split has no thread id, so the whole split stays visible.
  - The window can be dragged only through the revealed tab strip.
  - In a narrow window, a floating right/git panel can be closed on exit (hidden bars measure 0 wide while zen is on).
  - An overflowing tab strip's "+" button can sit under the pill. Leaving zen restores the background instantly (the fade is one-way).

#### Sound pack and per-project backgrounds

- **Code:** `src/renderer/fx/sounds/`, `src/renderer/fx/agentState/transitions.ts` (plus the monitor's new `onTransition` option), `src/renderer/fx/background/projectBackground.ts` (wired into `BackgroundLayer`), and two new groups in Settings → Effects (`SoundEffectsSettings.tsx`, `ProjectBackgroundSettings.tsx`, 7 new search entries).
- **Sound pack:** three short cues made with WebAudio (no audio files): done, error and attention, each under a second.
  - Fed by `onAgentFxTransition`. Done and error reuse `detectTurnTransition`; attention fires when a thread newly needs the user. Independent of the visual-effect switches.
  - Plays only when the pack and that cue are on and volume is above zero. By default only when the app is not in front or the thread is not in a visible pane (the same rule as upstream toasts); "Also when the app is in front" lifts that. At most one cue per 1.5 s.
  - The AudioContext is created on the first cue and suspended after 4 s of silence; a cue that cannot wake it within 1 s is dropped.
  - Starts and stops with `startAgentStateEffects` (`fx/agentState/index.ts`), so it runs only in the main window's desktop shell.
  - Upstream hook (marked): `playSound()` in `src/renderer/notifications.ts` returns early while `isSoundPackHandlingSounds()` is true (pack running and on), so nothing sounds twice. Everywhere else the upstream sound is unchanged.
- **Per-project backgrounds:** a project can override the background style and/or intensity. The layer uses the project in focus: the focused pane's thread or draft, the full-page draft or experiment, or the Home project on Home. Read outside React; the controller is updated only when the effective settings change. The group is disabled while the animated background is off.
- **Saves:** `viscosity:fx:v1` (see table). Defaults: sounds off, volume 0.6, "also when in front" off, each cue on.
- **Relies on:** **sounds are off by default**. "Reset effects to defaults" also clears sounds and project overrides.
- **Limits:**
  - Compact/PWA layouts and auxiliary thread windows keep the upstream sound.
  - A thread hidden behind an open Roundtable or Bots panel still counts as on screen, so its cue is silenced while the app is in front.
  - An idle thread outside panes and tabs whose attention flag flips without a turn gets no attention cue.
  - Stop ends a turn as idle, so it plays "done".
  - A remote browser can keep the AudioContext suspended until the user interacts with the page.
  - The "Cycle background style" command changes the global style, so nothing visible changes while the focused project overrides it.

#### Themes from a link, and sharing

- **Code:** `src/main/viscosity/themeFetch/` (main process), `src/renderer/theme/viscosity/` (`themeUrlImport.ts`, `themeImportPlan.ts`, `themeShare.ts`, `ThemeUrlImportDialog.tsx`, `ThemeShareMenu.tsx`), mounted in `src/renderer/views/SettingsOverlay/parts/CustomThemes.tsx`.
- **What it is:** Settings → Appearance → custom themes gets "Import from URL…" and "Share theme" (Copy JSON / Save as file; it replaces "Export as JSON", and the theme id is never included). A successful download opens the existing editor; nothing is saved until "Save and apply".
- **Import naming and dedupe** (`themeImportPlan.ts`, for file and link imports): same colours as an installed custom theme → that theme is applied instead of adding a copy. Name already taken → "Name (2)", "Name (3)" with a fresh id. Same colours as a built-in preset → kept as an editable copy on purpose.
- **Why main downloads:** the packaged window loads from `file:`, so a renderer fetch depends on each server's CORS headers. The fork-owned IPC channel `viscosity:theme:fetch` is exposed as `window.viscosityHost.themes`; it is not in the upstream procedure map. Hooks: one marked import and one marked line each in `src/main/desktopAppIpc.ts` and `src/main/preload.ts`.
- **Rules** (`themeFetchContract.ts`): **https only, on every redirect hop**; no credentials in the URL; URL up to 2,048 characters; **body up to 32 KB** (32,768 bytes, checked on the declared size and on the bytes read); **one 10 s deadline** covering redirects and body; at most 3 redirects (followed by hand); at most 4 downloads at once; main frame only. Main returns text only if it passes `parseThemeDocument` (v1), and the renderer parses it again and gives up after 12 s.
- **Saves:** imported themes go into the existing host `customThemes` setting (v1 schema); no new fields.
- **Clients:** "Import from URL…" shows only where the bridge exists (desktop). "Share theme" works everywhere; it is a settings control, not shell chrome.
- **Limits:** the download uses Node's global `fetch`, not Electron `net.fetch`, so it ignores system proxy settings and the OS certificate store (users behind a corporate proxy get the generic error). Private and loopback https hosts are not blocked, and an HTTP error returns its status code. Dedupe only matches installed custom themes.

#### Palette commands

- **Code:** `src/renderer/viscosity/commands/`. Entry `index.ts` registers the built-ins on import; `registry.ts` imports it and spreads `...viscosityCommands()` after `roundtableChatCommands()`.
- **Built-in ids** (`commandIds.ts`, group "ViscosityCode"):
  - Effects: `viscosity.effects.toggleBackground`, `viscosity.effects.cycleBackgroundStyle`, `viscosity.effects.toggleAgentEffects`, `viscosity.effects.openSettings`.
  - Themes: `viscosity.theme.viscosity`, `viscosity.theme.viscosityShowcase`, `viscosity.theme.toggleLightDark`.
  - Bots: `viscosity.bots.new`, `viscosity.bots.open`.
  - Account pools: `viscosity.accountPools.openAgentSettings`.
  - Layout: `viscosity.view.agents`, `viscosity.view.explorer`, `viscosity.view.sourceControl`, `viscosity.view.browser`.
- **Registered by features:** `missionControl.open`, `subscriptions.open`, `roundtable.askAll`, `viscosity.zen.toggle`.
- **Rules:** ids are saved in `keybindings.json` and feature-usage signals, so they never change once released. Titles must be unique within a context (`shortcutCatalog.test.ts`). Shell-only commands (effects toggles, Bots, layout) are hidden outside the shell. Theme commands work everywhere. The two Settings commands show only where that client's Settings has the section. Layout commands only reveal a surface, never close one. "Toggle light/dark mode" writes the shared host `themeMode` and pins an explicit mode when it was "system".
- **Not built on purpose:** Search (the palette is the search), a sidebar toggle (upstream `sidebar.toggle`), status bar visibility (the status bar cannot be hidden yet), and a second "Open Subscriptions".
- **Limits:** `missionControl.open`, `subscriptions.open` and `roundtable.askAll` sit outside the `viscosity.*` namespace; rename them only before the first release. "Cycle background style" ignores per-project overrides.

#### Account-pool follow-ups

- **Code:** `src/shared/accountPools.ts`, `src/host/accountPools/`, `src/host/remote/ThreadNotificationPublisher.ts`, `src/backend/` composition, `src/server/headlessRemoteComposition.ts`, `src/renderer/viscosity/accountPools/`, the usage UI (`UsageSettings.tsx`, `UsagePanel.tsx`, `UsagePanelHeaderActions.tsx`, `ProviderUsageRail.tsx`, `UsageProviderRow.tsx`), `src/supervisor/agents/acp/acpUserVisibleErrors.ts` and `src/supervisor/agents/cursor/` (`sdkErrorReasons.ts`, hooked into `sdkCanonicalMapping.ts`).
- **Held error notification:** `AccountPoolFailoverService.holdErrorNotification(threadId, agentKind)` holds the "error" notification while a failover is pending (or for a 2 s grace on a pooled chat thread). It drops it when the thread moved to another account or the error came late from the old session, and publishes it when the thread stays failed or after 10 s. `ThreadNotificationPublisher` takes it as an optional hook, wired on desktop (`BackendDesktopServices` → `DesktopRemoteAccessController`) and on the headless server.
- **Rate limits are not "out of usage":** shared ACP `isAcpUsageLimitMessage` needs account, plan, credit or payment wording and rejects per-minute or retry-in-seconds wording, so a bare HTTP 429 or `RESOURCE_EXHAUSTED` is no longer `usage_limited` (`isFatalAcpQuotaError` is unchanged). Cursor SDK errors are tagged `usage_limited` only from usage, spend or plan limit codes or wording. A failure with no reason fails over only at 100% used (`failureAvailability`) or after a recent provider-reported failure; `switchAtPercent` only decides which account is picked next.
- **Leave an account out:** optional `excludedMembers` per pool (max 16), applied everywhere through `poolMembersInUse` (host `resolveAccountPool`; renderer `enabledPoolMembers` / `activePoolFor`, which Smart start, Subscriptions and Mission Control use). The pool card has an include switch, a "Left out of the pool" badge and a warning when fewer than two accounts are included.
- **Credit balances:** `creditBalanceExhausted` counts a zero credit balance as "out" only for a credit-only account (one with no usage windows). Some providers report `credits.balance: 0` just to mean "no purchased credits"; with live windows, those accounts are judged by their windows. `memberAvailability` and `usagePercentLeft` (`poolModel.ts`) both use it, so failover, pool ranking, Smart start and Subscriptions agree.
- **Usage tracking:** `usageTracking.ts` (`selectCollectedUsageDisabledProviders`) shows pooled accounts as tracked, matching what the supervisor collects. Writes still use the stored list; a switch a pool needs is locked on.
- **Performance:** `selectHandoffFollowsUsageLimit` is cached per transcript (item-id array plus `runtimeStructuralVersionByThread`), so a `content.delta` costs one lookup.
- **"All accounts out" notices:** `BackendDurableServices` takes an optional `publishThreadNotice`. Both the headless server and the desktop app pass it (on desktop it is the `DesktopRemoteAccessController`'s `ThreadNotificationPublisher`), so the "exhausted" and "switch-failed" notices reach remote clients as `remote-user-notification` and the desktop owner once through the native notification event (existing wire shape, no protocol change).
- **Saves:** `excludedMembers` in host settings (see table).
- **Limits:**
  - On desktop, when every account is out, the owner still gets two notifications (the pool notice and the released generic error). Only the headless server replaces the generic one.
  - The pool notice reuses the `UserNotification` slots (title in `projectName`, text in `threadTitle`), and clients still add their generic error line.
  - Cursor's codes and wording were not checked against live SDK payloads.
  - A newer client writing `excludedMembers` to an older paired host is refused before any effect.
  - Phone and web pushes (`PushCoordinator`) are not held during a failover (the fork turns the push gateway off by default).
  - A pool with one account left in use still collects usage, though failover needs two.

**Still open when Step 5 was written:** i18n extraction and the 12 translations for every new string (until then they show in English, and `settingsSearchIndex.test.ts` fails on the new Effects entries); mounting the Smart start preferences in Settings; settings-search entries for Agent colours; FORK_CHANGES.md entries; and a `.agents/docs/versioning.md` inventory line for `excludedMembers`.

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
