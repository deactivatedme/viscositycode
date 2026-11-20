<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="ViscosityCode" />
</p>

<h1 align="center">ViscosityCode</h1>

<p align="center">
  <strong>One window for all your AI coding agents, with a Cursor-inspired interface.</strong><br />
  Run Claude, Codex, OpenCode, Gemini, Grok, Kimi Code, Qwen Code, Pi, Qoder, Factory Droid, Antigravity, Cursor, Command Code, Copilot, and fx side-by-side. Terminal and chat, any layout — with built-in MCP so agents can orchestrate each other and the app itself.
</p>

<p align="center">
  <em>Bring your own agent subscriptions & API keys</em>
</p>

> **ViscosityCode is a modified version of [Poracode](https://github.com/Porabuild/Poracode), licensed under Apache-2.0.**
> It keeps Poracode's engine — the supervisor, agent runtimes, ACP and MCP support, Git worktrees, and session persistence — and replaces the look and feel with a Cursor-inspired UI. ViscosityCode is not affiliated with or endorsed by the Poracode project. See [NOTICE](NOTICE) for attribution.

---

## What ViscosityCode changes

- **A Cursor-inspired interface** on top of the same agent engine: a new theme and layout for the desktop app on macOS and Windows.
- **Its own identity.** ViscosityCode installs, stores data, and registers its command line separately from Poracode (`~/.viscositycode`, app ID `com.viscositycode.app`, command `viscositycode`), so both apps can live on the same machine.
- **No calls home to Poracode.** Update checks and CLI self-update only use a ViscosityCode release feed when one is configured, and are off otherwise.

Everything below the interface — how agents run, how threads are saved, how worktrees and MCP servers work — comes from Poracode.

## Supported Agents

**Claude** · **Codex** · **OpenCode** · **Gemini** · **Grok** · **Kimi Code** · **Qwen Code** · **Pi** · **Qoder** · **Factory Droid** · **Antigravity** · **Cursor** · **Command Code** · **Copilot** · **fx** and any agent from the [ACP registry](https://agentclientprotocol.com).

## Features

If you use more than one AI coding agent, you know the pain: separate terminals, separate apps, no shared context. ViscosityCode puts them all in one place.

### Infinite Threads & Layouts

Mix TUI and GUI agents in any configuration. Arrange threads in horizontal and vertical splits, resize freely, and keep background sessions running while visible panes stay responsive.

### Unified Protocol GUI

A consistent chat interface for ACP and SDK agents — markdown, syntax highlighting, and tool call displays. Where a provider offers more than one runtime (for example Cursor ships CLI, ACP, and SDK), you pick which one a thread runs on.

### Crossagents

Let one agent delegate work to another across providers. Subagent output streams into the parent thread, background runs finish while the parent keeps working, and you can pin routing rules per task type.

### Built-in MCP & App Controls

ViscosityCode ships its own MCP servers. Point any agent at them to create and steer threads, organize projects, list and merge Git worktrees, commit and sync, open and merge pull requests, schedule runs, manage skills, and change settings — or add your own MCP servers over stdio, HTTP, or SSE.

### Agent Experiments

Run one prompt across several agents in parallel worktrees, then let an AI judge compare their code and answers, crown a winner, and merge it or open a PR.

### Scheduled Runs

Put recurring work on a schedule — nightly reviews, dependency sweeps, changelog drafts — and let ViscosityCode start the thread for you.

### Skills & Marketplace

Browse and install skills from public marketplaces, or import your own. One shared folder that every provider picks up automatically.

### On-Device Voice Input

Dictate a prompt with a keystroke. Whisper runs locally, with optional GPU acceleration, so your audio never leaves the machine.

### Checkpoints & Rollback

Rewind a conversation to any earlier message and restore the files with it, with a warning first when another thread shares the same tree.

### Project Workspaces

Group projects into workspaces and switch the whole sidebar between them, so dozens of repos stay one click apart.

### Git Worktrees

Group threads by worktree and drive parallel branches side by side, without leaving the app.

### Live Usage & Limits

See session and weekly quota for every provider — Claude Max, ChatGPT Pro, and more — at a glance.

### Terminal Fidelity

Run CLI agents in real terminal sessions, with the same output and controls you expect from your own shell.

### Session Persistence

Sessions are saved automatically, so you can close ViscosityCode and pick up right where you left off.

### Built-in Browser

Open web pages, attach browser context to agents, and keep research in the same workspace.

### Standalone Server & Remote Machines

Run the same backend without Electron, or connect a server from your SSH config and run agents on that machine. The engine's server, install, and operations guide is in [Standalone server: run, install, operate](docs/STANDALONE_SERVER.md) (written for upstream Poracode; ViscosityCode does not publish CLI release archives yet).

### In-App PRs

Review pull requests, browse diffs, stage changes, and generate AI commits — then let automation watch the PR, fix what fails, merge with your chosen method, and mark the thread done.

### Code Editor

Monaco-based editor with LSP support for quick edits without switching to your IDE.

### WSL Support

Use Windows and WSL projects side by side, with agent commands routed through the right environment automatically.

### ACP Registry

Install and run any agent from the [Agent Client Protocol](https://agentclientprotocol.com) registry directly from settings.

## Build from source

ViscosityCode does not publish prebuilt releases yet. The desktop app is a Tauri shell around the bundled standalone host; build it yourself:

| Platform | Format                                                    |
| -------- | --------------------------------------------------------- |
| macOS    | DMG (Apple silicon locally; Apple silicon or Intel in CI) |
| Windows  | NSIS installer (x64, built by the GitHub workflow)        |

```sh
bun install          # Bun version pinned in package.json; Node.js 26.13.0 or newer; Rust 1.98.1
bun run tauri:stage  # build the standalone host and stage it for the bundle
bun run tauri:build  # build ViscosityCode.app and the DMG
bun run tauri:smoke  # headless check of the bundled host
```

**On Windows:** the installer is unsigned, so SmartScreen may block it; click **More info** → **Run anyway**. The app needs the Microsoft Edge WebView2 runtime (preinstalled on Windows 11; the installer downloads it when missing). On first launch Windows Defender Firewall may show an alert for "Node.js JavaScript Runtime": that is the bundled host. **Cancel** is safe unless you use WSL projects, which need **Allow**.

`bun run dev` still runs the Electron app for development; Electron is no longer packaged or released. The Tauri app has no in-app updates yet: to update, quit it and replace the app with the new build.

**Coming from the Electron app?** The Tauri app cannot open a data folder (`~/.viscositycode`) that the Electron ViscosityCode app created: that app sealed its credential key with the macOS keychain, and there is no migration yet. The Tauri app installs over `ViscosityCode.app` (same identifier) and then shows an error page for that folder; nothing in it is changed or deleted. Until a migration ships, keep the Electron build for that data, or start the Tauri app on another folder, for example `VISCOSITY_TAURI_BASE_DIR=~/.viscositycode-tauri /Applications/ViscosityCode.app/Contents/MacOS/viscositycode-desktop`.

[BUILDING.md](BUILDING.md) covers prerequisites, each installer, signing and notarisation, and the GitHub Actions workflow that builds the macOS and Windows installers for you.

### Command line

The Tauri app does not register a `viscositycode` command yet. Its bundled launcher works from a terminal and uses the same data folder (`~/.viscositycode`), for example on macOS:

```sh
/Applications/ViscosityCode.app/Contents/Resources/standalone/bin/poracode -p "PROMPT" --directory PATH   # one-shot run
/Applications/ViscosityCode.app/Contents/Resources/standalone/bin/poracode serve --open                   # serve and open the web app
```

### Getting Started

1. Build and install ViscosityCode for your platform.
2. Install the AI agent CLIs you want to use (e.g., [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex](https://github.com/openai/codex)).
3. Open ViscosityCode, add your project, and start orchestrating.

## License

ViscosityCode is licensed under the [Apache License 2.0](LICENSE), like the Poracode project it is based on. See [NOTICE](NOTICE) for attribution and a summary of modifications.
