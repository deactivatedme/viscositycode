# ViscosityCode — handoff

Where the project stands, how to work on it, and what is left. Read this first, then [ARCHITECTURE_NOTES.md](ARCHITECTURE_NOTES.md) (how the app is put together and every fork decision) and [AGENTS.md](AGENTS.md) (the upstream project rules, which still apply except where this file says otherwise).

## What this is

ViscosityCode is a rebranded fork of [Poracode](https://github.com/Porabuild/Poracode) (Apache-2.0): an Electron + React + TypeScript desktop app that runs AI coding agents (Claude Code, Codex, Gemini CLI, Cursor, ACP agents, …) side by side. The fork keeps Poracode's backend, agent runtime, ACP/MCP, git/worktree and session-persistence code and replaces the look with a Cursor-inspired UI. It adds features for someone paying for several AI subscriptions.

- **Repository:** `https://github.com/deactivatedme/viscositycode`, branch `main` (remote `origin`).
- **Upstream:** remote `upstream` = Porabuild/Poracode. The fork starts at upstream commit `9b62823d5`; the local `master` branch tracks upstream. **Never push to `upstream`.**
- **History:** 54 fork commits on `main`, one feature per commit (`git log --oneline 9b62823d5..main`).
- **Licence:** Apache-2.0 kept; [NOTICE](NOTICE) and the README credit Poracode.

## Status

| Step | What                                                                                                                                                                                                                             | State                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1    | Learn the codebase, architecture notes, plan                                                                                                                                                                                     | Done                          |
| 2    | Rebrand (name, app ID, icons, data folder, CLI, no Poracode servers), 3 themes, Cursor layout (activity bar, sidebar, tab strip, status bar, palette), themed Monaco/terminal, window materials                                  | Done                          |
| 3    | WebGL2 animated background (mesh / particles / aurora), 2D fallback, 30 fps cap, pauses when hidden, translucent panels                                                                                                          | Done                          |
| 4    | Agent-state effects (thinking, streaming, tool, attention, error, done, typing) + Settings → Effects                                                                                                                             | Done                          |
| —    | Roundtable (several models on one task: build/review, debate, relay, race, compare), Bots (Codync-style, plus a Grok chat over the xAI API), account pools (several accounts per provider, automatic switch when usage runs out) | Done                          |
| 5    | Mission Control, Subscriptions dashboard, Smart start, Ask all models, per-agent colours, Zen mode, sound pack + per-project backgrounds, themes from a link, palette commands, account-pool follow-ups                          | Done                          |
| 6    | DMG + NSIS packaging, [BUILDING.md](BUILDING.md), GitHub Actions installer workflow                                                                                                                                              | Done                          |
| —    | Performance numbers                                                                                                                                                                                                              | Skipped by the owner          |
| —    | Screenshots of the account-pool screens and the Step 5 features                                                                                                                                                                  | **Not done** (see Open items) |

Last full unit suite: 36,009 tests passed. The only failures are the two that already fail on upstream (see Checks).

## Owner preferences (follow these)

- **Build end to end without stopping for approval.** Only stop for things that truly need the owner (credentials, irreversible or outward-facing actions).
- **English only.** Wrap user strings in Lingui macros and run `bun run i18n:extract` so the English catalog has them (otherwise production shows hashed IDs). Do **not** fill the 12 non-English catalogs; they fall back to English at compile time. This overrides the upstream rule about translating in the same change. Removing the other languages entirely was not requested.
- **Never steal focus.** Never raise or activate test windows (no `osascript … frontmost`). Drive the app over CDP only; anything needing a visible window must be scheduled with the owner.
- **Send real screenshots** of every implemented feature.
- **Logo:** the owner's "V" alone on a transparent background, no tile (`branding/assets/viscositycode-logo.png`; regenerate icons with `node branding/assets/build-icons.mjs --install`).
- **The animated background keeps animating with OS reduced motion on** (macOS and Windows); pausing for reduced motion is opt-in (`respectReducedMotion: false` by default).
- **Bots:** no "Grok Bot" — it has no developer API. Grok is only reached through the xAI API.
- **xAI API (follow strictly):** base `https://api.x.ai/v1` (US-only `https://us.api.x.ai/v1` serves text models grok-4.7/grok-4.6 only, +10% cost, no image/voice); `Authorization: Bearer $XAI_API_KEY`; text model `grok-4.7`, image model `grok-imagine-image-2.0`; use the Responses API `POST /v1/responses` with `input` (chat/completions is legacy); server-side tools `web_search`, `x_search`. The key stays in the main process (env `XAI_API_KEY` wins over the stored key).
- **Security:** never commit secrets or certificates (environment variables only); never auto-approve agent permissions; no phoning home to Poracode.

## Machine setup (the owner's Mac)

- Node 26.13.0 is in `~/.local/node-v26.13.0`, the pinned Bun in `~/.local/bin`. Rust and Java are **not** installed. The GitHub CLI (`gh`) is installed and logged in.
- Prefix every command:

  ```sh
  export PATH="$HOME/.local/bin:$HOME/.local/node-v26.13.0/bin:$PATH"; export TMPDIR="$(cd "$TMPDIR" && pwd -P)/"
  ```

  The `TMPDIR` realpath fix matters: macOS's `/var` → `/private/var` link otherwise breaks about a dozen path tests.

- 8 GB RAM: run focused tests (`bun run vitest run <paths> --maxWorkers=1`); the full suite takes about 20 minutes and must not run twice at once. Heavy commands queue on `scripts/heavy-run-gate.mjs`; that is normal.

## How the fork is organised

- **Fork-owned code:** `src/renderer/viscosity/**`, `src/renderer/fx/**`, `src/renderer/theme/viscosity/**`, `src/main/viscosity/**`, `src/shared/brand.ts`, `src/shared/viscosityRelease.ts`, `src/shared/viscosity/**`, `src/host/accountPools/**`, `src/shared/accountPools*.ts`, `scripts/viscosity/**`, `branding/**`.
- **Upstream files the fork touches** start with `// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.` (`#` in YAML), and each hook line carries `// ViscosityCode:`. Run `node scripts/viscosity/mark-modified-files.mjs` before committing: it adds missing notices and regenerates [FORK_CHANGES.md](FORK_CHANGES.md) (never edit that file by hand).
- **Branding:** `brandText()` rewrites "Poracode" → "ViscosityCode" in loaded catalogs, shared messages and displayed errors. Identity: app ID `com.viscositycode.app`, data folder `~/.viscositycode` (`-nightly`, `-dev`), CLI `viscositycode` / `viscositycode-next`. In-app updates are off unless `VISCOSITYCODE_UPDATE_REPO=owner/repo` is set at build time.
- **Desktop-shell gate:** fork chrome is scoped to `html[data-vc-shell]` (desktop main window, not compact). Compact/PWA, the extension and the native iOS/Android apps keep upstream behaviour.
- **Design tokens:** `--vc-*` in `src/renderer/theme/viscosity/tokens.css`.
- **Extension points (use these instead of editing upstream):**
  - Palette commands: `registerViscosityCommands(key, factory)` in `src/renderer/viscosity/commands/viscosityCommands.ts` (ids `viscosity.*`; upstream's registry spreads `viscosityCommands()`).
  - Activity bar / status bar: `registerActivityBarItem`, `registerStatusBarItem` under `src/renderer/viscosity/layout/`.
  - Center panels mount in `src/renderer/viscosity/layout/tabs/ViscosityCenterFrame.tsx`.
  - Mission Control tabs: `registerMissionControlTab` in `src/renderer/viscosity/missionControl/tabs.ts`.
  - Agent colours: spread `agentKindAttribute(kind)` on any per-agent element and style with `AGENT_ACCENT_CSS`.
  - Roundtable: `src/renderer/viscosity/roundtable/api.ts`; Bots: `src/renderer/viscosity/bots/api.ts`.
- **Provider isolation (upstream invariant):** no provider names or `kind === "<provider>"` branches in shared code; provider differences go through capabilities in the provider folder.

## Feature map

| Feature                        | Code                                                                                         | Notes                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Themes, layout, window         | `src/renderer/theme/viscosity`, `src/renderer/viscosity/layout`, `src/main/viscosity`        | 3 themes (dark default, light, showcase); macOS hidden-inset + vibrancy, Windows custom title bar with Mica/Acrylic                                                                                                                                        |
| Background + effects           | `src/renderer/fx`                                                                            | Settings in localStorage `viscosity:fx:v1`; debug hooks `window.__viscosityFx` (DEV)                                                                                                                                                                       |
| Roundtable                     | `src/renderer/viscosity/roundtable`                                                          | Store version 1; demo seeding `window.__viscosityRoundtable.simulate(id, pattern)` (DEV)                                                                                                                                                                   |
| Bots + xAI                     | `src/renderer/viscosity/bots`, `src/main/viscosity/xai`                                      | Key encrypted with Electron safeStorage                                                                                                                                                                                                                    |
| Account pools                  | `src/shared/accountPools.ts`, `src/host/accountPools`, `src/renderer/viscosity/accountPools` | Host setting `accountPools` (pool shape v2 adds optional `excludedMembers`); works for Claude, Codex, Gemini, Cursor, Devin. **Antigravity can't hold several accounts** (its agent rewrites one fixed Keychain item on every start); the UI explains this |
| Mission Control                | `src/renderer/viscosity/missionControl`                                                      | Activity item, "N need you" status item, command `viscosity.missionControl.open`                                                                                                                                                                           |
| Subscriptions                  | `src/renderer/viscosity/subscriptions`                                                       | Mission Control tab; command `viscosity.subscriptions.open`                                                                                                                                                                                                |
| Smart start                    | `src/renderer/viscosity/smartStart`                                                          | "Auto" in the new-thread composer; preferences in Settings → Agents                                                                                                                                                                                        |
| Ask all models                 | `roundtable` pattern `compare`                                                               | Answer-only, no file changes                                                                                                                                                                                                                               |
| Agent colours                  | `src/renderer/viscosity/agentColors`                                                         | localStorage `viscosity:agent-colors:v1`; Settings → Appearance                                                                                                                                                                                            |
| Zen mode                       | `src/renderer/viscosity/zen`                                                                 | Command "Toggle Zen mode", Esc or the pill to exit; never persisted; no default key                                                                                                                                                                        |
| Sounds, per-project background | `src/renderer/fx/sounds`, `src/renderer/fx/background`                                       | Sounds off by default, WebAudio only                                                                                                                                                                                                                       |
| Themes from a link             | `src/renderer/theme/viscosity`, `src/main/viscosity/themeFetch`                              | https only, 32 KB, 10 s, schema-checked, local/private hosts refused                                                                                                                                                                                       |

## Checks

- Quick: `bun run checks`. Before handing off: `bun run typecheck --force` plus focused tests. Full: `bun run verify`.
- The pre-commit hook runs lint-staged and `bun run typecheck`; it fails while someone else's half-written code is in the tree.
- **Known failures that are not ours:**
  - `src/shared/remote/contract/native/runtime.test.ts`: needs Java.
  - `src/supervisor/agents/claude/sdkSession.browser.test.ts` "streams a reply while initial MCP connection is still pending": fails on upstream too.
  - `protocol/remote/v3/binding-format.test.ts`: times out only under full-suite load.
- `bun run fmt:check` covers Markdown too: run `bun fmt <file>` after editing docs.

## Building

See [BUILDING.md](BUILDING.md). On this Mac (no Rust):

```sh
PORACODE_ALLOW_MISSING_COMPUTER_USE_HELPER=1 PORACODE_ALLOW_MISSING_MCP_RELAY=1 PORACODE_ALLOW_MISSING_GIT_HELPER=1 CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:mac:arm
```

This produced `release/ViscosityCode-2.0.0-arm64.dmg` (about 183 MB). It is unsigned but ad-hoc signed as a whole (`codesign --verify` passes); Gatekeeper still rejects it until it is notarised, so the first open needs right-click → Open. Windows installers need Windows or the GitHub workflow `.github/workflows/viscosity-desktop.yml` (manual run, or push a `v*` tag for a draft release). Signing secrets: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.

## Screenshots (how to take them)

```sh
node .agents/skills/interactive-testing/scripts/poracode-cdp.mjs launch --new --mode mock --root "$HOME/.poracode-smoke/<name>"
```

Then use `eval` / `shot` / `click` / `stop` with `--session "$HOME/.poracode-smoke/<name>/session.json"`. `window.__poracodeDev.stores` exposes the main stores for seeding mock data; click with DOM `.click()` in `eval` (pointer clicks can report "occluded"). **The launcher refuses to start while the Mac is locked.** Stop the session and delete its folder afterwards (each one is about 2.6 GB). Earlier helper scripts live in `tmp/` (gitignored: `shoot-final.sh`, `shoot-rt.sh`, `fx-demo.mjs`).

## Open items

1. **Screenshots still owed:** account-pool screens (pool card in Settings → the provider's profiles, usage settings) and every Step 5 feature. Seeding notes per feature: Mission Control opens with `useMissionControlViewStore.setState({ shown: true })`; Subscriptions needs seeded `agentStatuses`, `agentInstances`, `accountPools` and `providerUsage` snapshots; Ask all uses `__viscosityRoundtable.simulate("demo-compare", "compare")`; theme import needs a fake `window.viscosityHost.themes` bridge in mock mode.
2. **The packaged app has not been launched yet**; only its bundle, identity and signature were checked.
3. **Scheduled upstream workflows will run weekly on `main`** now that the repo is on GitHub: `dependency-audit.yml`, `quality-kpis.yml`, `windows-wsl-qualification.yml`, `v2-perf-qualification.yml`. They are Poracode's and will likely fail without its secrets; consider disabling them (`gh workflow disable <file>`). `ci.yml` only runs on `master`, so nothing checks pushes to `main`; consider adding `main` to its branch filters.
4. **Windows builds are untested**; the workflow has never run.
5. **Minor known limitations** from the Step 5 reviews (none blocking):
   - phone/PWA push alerts are not held during an account switch (desktop and remote-client notifications are);
   - a Subscriptions row whose last refresh failed shows its old bars without a warning;
   - Smart start's default order can list providers that are no longer installed;
   - failed answers in a comparison have no per-column retry;
   - installing a new agent can shift another agent's default colour;
   - "Share theme" also shows outside the desktop shell;
   - the internal macOS plug-in bundle is still named `PoracodeLockedUse.bundle`.
6. **New strings show in English** in the other 12 languages (by design).

## Commit and PR rules

`type(scope): subject`, imperative, ≤ 72 characters; the body explains why; stage explicit paths; never use `--no-verify`. One feature per commit. Push only to `origin`.
