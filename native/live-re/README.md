# viscosity-live-re

Native Rust stdio MCP server (`0.1.0`) that lets coding agents debug **running**
programs. It drives LLDB through `lldb-dap` (the Debug Adapter Protocol); there
is no Frida and nothing is injected into the target. Use it only on software you
are entitled to examine: your own builds, CTFs, interoperability work, malware
triage, authorised research.

Static analysis stays in IDA Pro / Ghidra (their MCP servers have no live
attach). This server covers the live part: attach, break, step, read registers
and memory, and disassemble what is actually mapped.

## Targets per host

| Host    | Targets                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| macOS   | `local`, `ios-simulator` (Xcode), `ios-device` (Xcode 15+ `devicectl`), `android` (`adb`) |
| Windows | `local`, `android`; `ios-device` only if Apple tooling exists (normally not)              |
| Linux   | `local`, `android`                                                                        |

`re_environment` reports which are available and how to install what is missing.

- **Debugger discovery:** `VISCOSITY_LIVE_RE_LLDB_DAP` (explicit path), then on
  macOS `xcrun -f lldb-dap`, then `lldb-dap` / `lldb-vscode` on `PATH`, then
  standard LLVM directories (`C:\Program Files\LLVM\bin`, `/usr/lib/llvm-*/bin`,
  Homebrew `llvm`).
- **macOS:** SIP stays on. Apple-signed and hardened-runtime processes cannot be
  attached unless they carry `get-task-allow`; your own unsigned or development
  builds can. Simulator apps are host processes under `CoreSimulator/Devices/<udid>/`.
- **iOS device:** `platform select remote-ios`, `device select <id>`,
  `device process attach`. Only development-signed apps (`get-task-allow`) on a
  paired device in Developer Mode.
- **Android:** the user starts `lldb-server platform` on the device (the
  `re_attach` error hint lists the `adb push` / `run-as` / `adb forward`
  steps); the server only runs `platform select remote-android` +
  `platform connect connect://<serial>:<port>` + `process attach`. It never
  pushes binaries.

## Tools

`re_environment`, `re_list_processes`, `re_list_devices`, `re_attach`,
`re_launch`, `re_detach`, `re_sessions`, `re_continue`, `re_pause`, `re_step`,
`re_breakpoint_set`, `re_breakpoint_list`, `re_breakpoint_clear`, `re_threads`,
`re_backtrace`, `re_registers`, `re_read_memory`, `re_disassemble`, `re_modules`,
`re_evaluate`, `re_output`, `re_wait`.

- Execution is asynchronous: `re_continue`, `re_step` and `re_pause` return
  at once; `re_wait` (up to 60 s) returns the next stop or exit with the
  reason, thread and top frames. Resuming discards older, unconsumed stops.
- `re_attach` leaves the process stopped; `re_launch` stops at entry unless
  `stopAtEntry: false`.
- `re_evaluate` with `context: "repl"` (the default) runs the text as a **raw
  LLDB command** (sent with lldb-dap's backtick command prefix), so it has full
  LLDB power over the debuggee. `context: "watch"` evaluates an expression in
  the current frame.
- `re_detach` kills launched programs and detaches from attached ones unless
  `kill` says otherwise.

Every result has `structuredContent` plus a text block with a one-line summary
and a text block with the same JSON (for clients without structured content).
Tool failures are `isError` results with an optional `hint`.

## Limits

- Every DAP request has a timeout (10 s; launch/attach 30 s; `waitFor`,
  iOS-device and Android attaches 55 s).
- `re_read_memory` ≤ 65 536 bytes, `re_disassemble` ≤ 400 instructions,
  `re_output` and `re_evaluate` ≤ 64 KiB of text per call, buffered output
  ≤ 2 MiB per session (oldest dropped first, reported as `droppedBytes`),
  8 sessions, 16 concurrent tool calls, 500 processes per list.
- Text spliced into LLDB commands (`name`, `deviceId`) is validated, so it
  cannot carry extra commands.
- Each session owns one `lldb-dap` child. `re_detach`, stdin EOF and
  SIGINT/SIGTERM close every session (launched debuggees killed, attached ones
  detached) and kill the adapter.

## Contract

`viscosity-live-re --hello` prints one JSON line: `helper`, `helperVersion`,
`protocolVersion` (tool contract, currently `1`), `mcpProtocolVersions`,
`platform`, `arch`. `--environment` prints the read-only setup report the
desktop app shows (`environmentVersion` 1: tools, SIP, developer-tools access,
per-target `state` and `reason` codes). The probe runs `lldb-dap --version`
(5 s); a present but broken lldb-dap is reported with tool status `unknown` and
its debugger targets as `limited` with reason `debugger-needs-python`,
`debugger-missing-library` or `debugger-failed`. On Windows a missing DLL
(STATUS_DLL_NOT_FOUND) counts as `debugger-needs-python`, since liblldb.dll
ships beside lldb-dap.exe. A slow start that hits the 5 s limit counts as found
without a version, not broken. When `VISCOSITY_LIVE_RE_PROTOCOL` is set
to anything but the tool contract version, the server exits with code 3 before
MCP starts. Both versions live in `src/version.rs` and are mirrored in
`src/shared/viscosity/liveRe.ts`. On macOS nothing runs `xcrun` or a `/usr/bin`
developer tool before `xcode-select -p` succeeds, so the Command Line Tools
installer never pops up. No tool declares `readOnlyHint`; `re_attach`,
`re_launch` and `re_evaluate` declare `destructiveHint`. Unknown arguments exit
with code 2. MCP protocol versions
`2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05` are negotiated;
an unknown client version gets the newest.

## Develop

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test            # live tests compile a C program with `cc`; skipped without lldb-dap
cargo build --release
```

Staged by `node scripts/prepare-live-re.mjs` into
`resources/wsl-helpers/live-re/<target>/` (darwin-universal, win32-x64,
win32-arm64); the supervisor adds it as the `live_re` MCP server when a chat
sets `mcpServerOverrides["viscosity.live-re"]`.
