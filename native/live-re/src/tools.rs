//! MCP tool catalog and handlers. Every handler validates its arguments and
//! returns `Ok((summary, structured))` or a `ToolError`; nothing here panics.

use crate::dap::truncate_at_char;
use crate::host::{self, MAX_PROCESSES, ProcessInfo};
use crate::session::{BpSpec, MAX_SESSIONS, REQUEST_TIMEOUT, Session, Sessions, StartRequest};
use base64::Engine;
use serde_json::{Map, Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub const MAX_READ_BYTES: u64 = 65_536;
pub const MAX_INSTRUCTIONS: u64 = 400;
pub const MAX_TEXT_PER_CALL: usize = 64 * 1024;
pub const MAX_WAIT_MS: u64 = 60_000;
const MAX_FRAMES: u64 = 200;
const MAX_MODULES: usize = 1000;
const ATTACH_TIMEOUT: Duration = Duration::from_secs(30);
/// waitFor and device attaches stay under common 60 s MCP client timeouts.
const LONG_ATTACH_TIMEOUT: Duration = Duration::from_secs(55);
const TARGETS: [&str; 4] = ["local", "ios-simulator", "ios-device", "android"];

#[derive(Debug)]
pub struct ToolError {
    pub message: String,
    pub hint: Option<String>,
}

impl From<String> for ToolError {
    fn from(message: String) -> Self {
        Self {
            message,
            hint: None,
        }
    }
}

impl From<&str> for ToolError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

fn with_hint(message: impl Into<String>, hint: impl Into<String>) -> ToolError {
    ToolError {
        message: message.into(),
        hint: Some(hint.into()),
    }
}

pub type ToolResult = Result<(String, Value), ToolError>;

// ---------------------------------------------------------------- catalog

/// Tools that run code in, start, or stop a target. No tool ever declares
/// `readOnlyHint: true`: listing processes and reading memory are sensitive
/// too, so every call goes through the agent's normal approval.
const DESTRUCTIVE_TOOLS: [&str; 3] = ["re_attach", "re_launch", "re_evaluate"];

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    let mut tool = json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        },
    });
    if DESTRUCTIVE_TOOLS.contains(&name) {
        tool["annotations"] = json!({"destructiveHint": true});
    }
    tool
}

fn session_prop() -> Value {
    json!({"type": "string", "description": "Session id returned by re_attach or re_launch."})
}

fn thread_prop() -> Value {
    json!({"type": "integer", "description": "Thread id (defaults to the thread that last stopped)."})
}

fn address_prop(what: &str) -> Value {
    json!({"type": ["string", "integer"], "description": format!("{what} as 0x-prefixed hex or a decimal integer.")})
}

pub fn tool_list() -> Vec<Value> {
    let session_only = || json!({"sessionId": session_prop()});
    let target =
        json!({"type": "string", "enum": TARGETS, "description": "Where the live process runs."});
    vec![
        tool(
            "re_environment",
            "Report what live-process debugging this host supports: OS/arch, the lldb-dap debugger \
             path and version, SIP status (macOS, read-only), device tooling (simctl, devicectl, adb) \
             with install hints, and which target kinds are available.",
            json!({}),
            &[],
        ),
        tool(
            "re_list_processes",
            "List live processes on a target (local host, iOS simulator, iOS device, Android) with \
             pid, name and path when available, so you can pick one for re_attach.",
            json!({
                "target": target,
                "filter": {"type": "string", "description": "Case-insensitive substring of name or path."},
                "deviceId": {"type": "string", "description": "Simulator UDID, iOS device id, or adb serial."},
            }),
            &["target"],
        ),
        tool(
            "re_list_devices",
            "List iOS simulators, connected iOS devices and Android devices that live processes can \
             be debugged on.",
            json!({}),
            &[],
        ),
        tool(
            "re_attach",
            "Attach LLDB to a RUNNING process and return a sessionId. The process is stopped after \
             attaching; use re_continue to resume it. local/ios-simulator attach on this host; \
             ios-device needs a development-signed app (get-task-allow); android needs an \
             lldb-server you started on the device. waitFor (with name) waits up to 55 s for the \
             process to launch.",
            json!({
                "target": target,
                "pid": {"type": "integer", "description": "Process id to attach to."},
                "name": {"type": "string", "description": "Process name (exact) when pid is not given."},
                "waitFor": {"type": "boolean", "description": "Wait for a process with this name to launch."},
                "deviceId": {"type": "string", "description": "Simulator UDID, iOS device id (required for ios-device), or adb serial."},
                "port": {"type": "integer", "description": "android only: lldb-server platform port (default 5039)."},
            }),
            &["target"],
        ),
        tool(
            "re_launch",
            "Launch a local program under LLDB as a live debug session and return a sessionId. \
             stopAtEntry (default true) stops before main so you can set breakpoints first.",
            json!({
                "program": {"type": "string", "description": "Path to the executable."},
                "args": {"type": "array", "items": {"type": "string"}},
                "cwd": {"type": "string"},
                "env": {"type": "object", "additionalProperties": {"type": "string"}},
                "stopAtEntry": {"type": "boolean"},
            }),
            &["program"],
        ),
        tool(
            "re_detach",
            "End a live debug session. kill=true terminates the process; the default kills launched \
             programs and leaves attached processes running.",
            json!({"sessionId": session_prop(), "kill": {"type": "boolean"}}),
            &["sessionId"],
        ),
        tool(
            "re_sessions",
            "List open live debug sessions with their process id and run state.",
            json!({}),
            &[],
        ),
        tool(
            "re_continue",
            "Resume the live process. Returns immediately; call re_wait for the next stop or exit.",
            json!({"sessionId": session_prop(), "threadId": thread_prop()}),
            &["sessionId"],
        ),
        tool(
            "re_pause",
            "Interrupt the running live process. Call re_wait to get the stop location.",
            json!({"sessionId": session_prop(), "threadId": thread_prop()}),
            &["sessionId"],
        ),
        tool(
            "re_step",
            "Step a stopped thread of the live process: in, over, out (source level) or instruction \
             (one machine instruction). Call re_wait for the new location.",
            json!({
                "sessionId": session_prop(),
                "threadId": thread_prop(),
                "kind": {"type": "string", "enum": ["in", "over", "out", "instruction"]},
            }),
            &["sessionId", "kind"],
        ),
        tool(
            "re_breakpoint_set",
            "Set a breakpoint in the live process by function name, address, or file+line, with an \
             optional condition expression.",
            json!({
                "sessionId": session_prop(),
                "function": {"type": "string"},
                "address": address_prop("Instruction address"),
                "file": {"type": "string"},
                "line": {"type": "integer", "minimum": 1},
                "condition": {"type": "string"},
            }),
            &["sessionId"],
        ),
        tool(
            "re_breakpoint_list",
            "List breakpoints in a live debug session and whether LLDB resolved them.",
            session_only(),
            &["sessionId"],
        ),
        tool(
            "re_breakpoint_clear",
            "Remove one breakpoint (id) or all breakpoints from a live debug session.",
            json!({"sessionId": session_prop(), "id": {"type": "integer"}}),
            &["sessionId"],
        ),
        tool(
            "re_threads",
            "List threads of the live process.",
            session_only(),
            &["sessionId"],
        ),
        tool(
            "re_backtrace",
            "Stack frames of a thread in the stopped live process.",
            json!({
                "sessionId": session_prop(),
                "threadId": thread_prop(),
                "levels": {"type": "integer", "minimum": 1, "maximum": MAX_FRAMES},
            }),
            &["sessionId"],
        ),
        tool(
            "re_registers",
            "CPU registers of a frame in the stopped live process (general-purpose set unless all=true).",
            json!({
                "sessionId": session_prop(),
                "threadId": thread_prop(),
                "frame": {"type": "integer", "minimum": 0, "description": "Frame index (0 = innermost)."},
                "all": {"type": "boolean", "description": "Include every register set (FP/vector too)."},
            }),
            &["sessionId"],
        ),
        tool(
            "re_read_memory",
            "Read up to 65536 bytes of the live process's memory; returns hex and ASCII.",
            json!({
                "sessionId": session_prop(),
                "address": address_prop("Start address"),
                "count": {"type": "integer", "minimum": 1, "maximum": MAX_READ_BYTES},
            }),
            &["sessionId", "address", "count"],
        ),
        tool(
            "re_disassemble",
            "Disassemble up to 400 instructions of the live process's memory starting at an address.",
            json!({
                "sessionId": session_prop(),
                "address": address_prop("Start address"),
                "instructionCount": {"type": "integer", "minimum": 1, "maximum": MAX_INSTRUCTIONS},
            }),
            &["sessionId", "address"],
        ),
        tool(
            "re_modules",
            "Modules (executable and libraries) loaded in the live process, with load addresses.",
            session_only(),
            &["sessionId"],
        ),
        tool(
            "re_evaluate",
            "Evaluate in the live process. context=watch evaluates an expression in the current frame; \
             context=repl runs the text as a raw LLDB command (for example `register read`, \
             `memory find`, `image lookup -n main`), with full LLDB power over the debuggee.",
            json!({
                "sessionId": session_prop(),
                "expression": {"type": "string"},
                "context": {"type": "string", "enum": ["repl", "watch"]},
                "frameId": {"type": "integer", "description": "DAP frame id from re_backtrace (default: top frame)."},
            }),
            &["sessionId", "expression"],
        ),
        tool(
            "re_output",
            "Buffered stdout/stderr/console output of a live debug session after sinceSeq (64 KiB per call; \
             pass nextSeq back to page).",
            json!({"sessionId": session_prop(), "sinceSeq": {"type": "integer", "minimum": 0}}),
            &["sessionId"],
        ),
        tool(
            "re_wait",
            "Wait (up to 60 s) for the live process's next stop or exit and return the reason, thread \
             and top frames. Returns timedOut=true if it is still running.",
            json!({
                "sessionId": session_prop(),
                "timeoutMs": {"type": "integer", "minimum": 0, "maximum": MAX_WAIT_MS},
            }),
            &["sessionId"],
        ),
    ]
}

// ---------------------------------------------------------------- arguments

fn opt_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(format!("{key} must be a string").into()),
    }
}

fn req_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    opt_str(args, key)?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("{key} is required").into())
}

fn opt_u64(args: &Value, key: &str, max: u64) -> Result<Option<u64>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match value.as_u64() {
            Some(n) if n <= max => Ok(Some(n)),
            Some(n) => Err(format!("{key} is {n}, the maximum is {max}").into()),
            None => Err(format!("{key} must be a non-negative integer").into()),
        },
    }
}

fn opt_bool(args: &Value, key: &str) -> Result<Option<bool>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(format!("{key} must be a boolean").into()),
    }
}

pub fn parse_address(value: Option<&Value>, key: &str) -> Result<u64, ToolError> {
    let parsed = match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => {
            let s = s.trim();
            match s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
                Some(hex) => u64::from_str_radix(&hex.replace('_', ""), 16).ok(),
                None => s.parse().ok(),
            }
        }
        _ => return Err(format!("{key} is required").into()),
    };
    parsed.ok_or_else(|| format!("{key} must be 0x-prefixed hex or a decimal u64").into())
}

/// Text spliced into LLDB commands: refuse quotes, backslashes and control
/// characters so a name can't smuggle extra commands.
fn lldb_safe(value: &str, key: &str) -> Result<(), ToolError> {
    if value.is_empty()
        || value
            .chars()
            .any(|c| c == '"' || c == '\\' || c == '`' || c.is_control())
    {
        return Err(format!("{key} contains characters that cannot be passed to LLDB").into());
    }
    Ok(())
}

fn device_safe(value: &str) -> Result<(), ToolError> {
    if value.is_empty()
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c))
    {
        return Err("deviceId may only contain letters, digits, '-', '_', '.', ':'".into());
    }
    Ok(())
}

fn target_arg(args: &Value) -> Result<&str, ToolError> {
    let target = req_str(args, "target")?;
    if !TARGETS.contains(&target) {
        return Err(format!("target must be one of {}", TARGETS.join(", ")).into());
    }
    Ok(target)
}

fn session_arg(sessions: &Sessions, args: &Value) -> Result<Arc<Session>, ToolError> {
    Ok(sessions.get(req_str(args, "sessionId")?)?)
}

fn thread_arg(session: &Session, args: &Value) -> Result<i64, ToolError> {
    match opt_u64(args, "threadId", i64::MAX as u64)? {
        Some(id) => Ok(id as i64),
        None => Ok(session.default_thread()?),
    }
}

// ---------------------------------------------------------------- dispatch

pub fn call(sessions: &Sessions, name: &str, args: &Value) -> Option<ToolResult> {
    if !args.is_object() {
        return Some(Err("arguments must be an object".into()));
    }
    Some(match name {
        "re_environment" => environment(),
        "re_list_processes" => list_processes(args),
        "re_list_devices" => Ok(("device inventory".into(), host::list_devices())),
        "re_attach" => attach(sessions, args),
        "re_launch" => launch(sessions, args),
        "re_detach" => detach(sessions, args),
        "re_sessions" => list_sessions(sessions),
        "re_continue" => resume(sessions, args),
        "re_pause" => pause(sessions, args),
        "re_step" => step(sessions, args),
        "re_breakpoint_set" => breakpoint_set(sessions, args),
        "re_breakpoint_list" => breakpoint_list(sessions, args),
        "re_breakpoint_clear" => breakpoint_clear(sessions, args),
        "re_threads" => threads(sessions, args),
        "re_backtrace" => backtrace(sessions, args),
        "re_registers" => registers(sessions, args),
        "re_read_memory" => read_memory(sessions, args),
        "re_disassemble" => disassemble(sessions, args),
        "re_modules" => modules(sessions, args),
        "re_evaluate" => evaluate(sessions, args),
        "re_output" => output(sessions, args),
        "re_wait" => wait(sessions, args),
        _ => return None,
    })
}

// ---------------------------------------------------------------- host tools

fn environment() -> ToolResult {
    let env = host::environment();
    let available: Vec<&str> = env["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|t| t["available"] == true)
        .filter_map(|t| t["target"].as_str())
        .collect();
    let debugger = env["debugger"]["path"].as_str().unwrap_or("not found");
    let summary = format!(
        "{} {}; lldb-dap: {debugger}; available targets: {}",
        env["host"]["os"].as_str().unwrap_or("?"),
        env["host"]["arch"].as_str().unwrap_or("?"),
        if available.is_empty() {
            "none".to_string()
        } else {
            available.join(", ")
        },
    );
    Ok((summary, env))
}

fn filtered(list: Vec<ProcessInfo>, filter: Option<&str>) -> (Vec<Value>, usize) {
    let needle = filter.map(str::to_lowercase);
    let matching: Vec<ProcessInfo> = list
        .into_iter()
        .filter(|p| {
            needle.as_ref().is_none_or(|n| {
                p.name.to_lowercase().contains(n)
                    || p.path
                        .as_deref()
                        .is_some_and(|path| path.to_lowercase().contains(n))
            })
        })
        .collect();
    let total = matching.len();
    (
        matching
            .iter()
            .take(MAX_PROCESSES)
            .map(ProcessInfo::to_json)
            .collect(),
        total,
    )
}

fn list_processes(args: &Value) -> ToolResult {
    let target = target_arg(args)?;
    let device_id = opt_str(args, "deviceId")?;
    if let Some(id) = device_id {
        device_safe(id)?;
    }
    let list = host::list_processes(target, device_id)?;
    let (processes, total) = filtered(list, opt_str(args, "filter")?);
    let summary = format!(
        "{total} {target} processes{}",
        if total > MAX_PROCESSES {
            format!(" (showing the first {MAX_PROCESSES}; narrow with filter)")
        } else {
            String::new()
        }
    );
    Ok((
        summary,
        json!({"target": target, "total": total, "truncated": total > MAX_PROCESSES, "processes": processes}),
    ))
}

// ---------------------------------------------------------------- sessions

fn attach_hint(target: &str) -> String {
    match target {
        "ios-device" => "The app must be debuggable: development-signed with the get-task-allow \
            entitlement (installed from Xcode with a development profile). App Store, TestFlight and \
            system apps cannot be attached. The device must be paired, unlocked, in Developer Mode, \
            and Xcode 15+ (devicectl) must be installed."
            .into(),
        "android" => "Start lldb-server on the device yourself, then attach: 1) adb push \
            <NDK>/toolchains/llvm/prebuilt/<host>/lib/clang/<ver>/lib/linux/<abi>/lldb-server \
            /data/local/tmp/  2) adb shell chmod +x /data/local/tmp/lldb-server  3) debuggable app: \
            adb shell run-as <package> cp /data/local/tmp/lldb-server . && adb shell run-as <package> \
            ./lldb-server platform --listen '*:5039' --server  (rooted device: adb shell su -c \
            '/data/local/tmp/lldb-server platform --listen \"*:5039\" --server')  4) adb forward \
            tcp:5039 tcp:5039 (LLDB also forwards ports through adb itself, so adb must be on PATH). \
            Then call re_attach with target android, deviceId (adb serial) and port."
            .into(),
        _ if cfg!(target_os = "macos") => "SIP blocks attaching to Apple-signed and hardened-runtime \
            processes unless they carry com.apple.security.get-task-allow. Your own unsigned or \
            development builds can be attached; if attaching prompts or is denied, enable developer \
            mode with `sudo DevToolsSecurity -enable`."
            .into(),
        _ if cfg!(windows) => "Attaching to another user's or an elevated process needs an elevated \
            ViscosityCode; protected processes (anti-malware, DRM) cannot be attached."
            .into(),
        _ => "Linux restricts ptrace: check /proc/sys/kernel/yama/ptrace_scope (1 allows only \
            descendants; `sudo sysctl kernel.yama.ptrace_scope=0` relaxes it) or run as the \
            process owner."
            .into(),
    }
}

fn session_capacity(sessions: &Sessions) -> Result<(), ToolError> {
    if sessions.count() >= MAX_SESSIONS {
        return Err(format!("{MAX_SESSIONS} sessions are open; re_detach one first").into());
    }
    Ok(())
}

fn resolve_pid(target: &str, name: &str, device_id: Option<&str>) -> Result<i64, ToolError> {
    let list = host::list_processes(target, device_id)?;
    let matches: Vec<&ProcessInfo> = list.iter().filter(|p| p.name == name).collect();
    match matches.as_slice() {
        [one] => Ok(one.pid),
        [] => Err(format!(
            "no {target} process named {name:?}; see re_list_processes or use waitFor"
        )
        .into()),
        many => Err(format!(
            "{} processes are named {name:?} (pids {}); pass pid",
            many.len(),
            many.iter()
                .map(|p| p.pid.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
        .into()),
    }
}

/// Host pids that must never be stopped: this server and its ancestors.
fn refuse_own_chain(pid: i64) -> Result<(), ToolError> {
    if host::self_and_ancestors().contains(&pid) {
        return Err(format!(
            "pid {pid} is this debugger server or one of its parents (the agent or app \
             running it); attaching would freeze them with no way to resume"
        )
        .into());
    }
    Ok(())
}

fn stop_json(session: &Session, event: &Value) -> (String, Value) {
    let kind = event["event"].as_str().unwrap_or("");
    let body = &event["body"];
    if kind != "stopped" {
        let code = body.get("exitCode").cloned().unwrap_or(Value::Null);
        let summary = if kind == "exited" {
            format!("process exited with code {code}")
        } else {
            "debug session terminated".into()
        };
        return (summary, json!({"event": kind, "exitCode": code}));
    }
    let reason = body["reason"].as_str().unwrap_or("unknown");
    let thread = body["threadId"].as_i64();
    let frames = thread
        .and_then(|t| {
            session
                .dap
                .request(
                    "stackTrace",
                    json!({"threadId": t, "startFrame": 0, "levels": 5}),
                    REQUEST_TIMEOUT,
                )
                .ok()
        })
        .map(|b| simplify_frames(&b))
        .unwrap_or_default();
    let place = frames
        .first()
        .and_then(|f| f["name"].as_str())
        .unwrap_or("unknown location");
    let summary = format!(
        "stopped ({reason}) in thread {} at {place}",
        thread.map_or("?".into(), |t| t.to_string())
    );
    (
        summary,
        json!({
            "event": "stopped",
            "reason": reason,
            "description": body.get("description").or_else(|| body.get("text")),
            "threadId": thread,
            "hitBreakpointIds": body.get("hitBreakpointIds"),
            "frames": frames,
        }),
    )
}

fn started(session: Arc<Session>, first_stop: Option<Value>, verb: &str) -> ToolResult {
    let mut data = session.to_json();
    let mut summary = format!("{verb} {} as session {}", session.label, session.id);
    if let Some(event) = first_stop {
        let (stop_summary, stop) = stop_json(&session, &event);
        summary = format!("{summary}; {stop_summary}");
        if let Some(obj) = data.as_object_mut() {
            obj.insert("stop".into(), stop);
        }
    }
    Ok((summary, data))
}

fn attach(sessions: &Sessions, args: &Value) -> ToolResult {
    let target = target_arg(args)?;
    session_capacity(sessions)?;
    let pid = opt_u64(args, "pid", i64::MAX as u64)?;
    let name = opt_str(args, "name")?;
    let wait_for = opt_bool(args, "waitFor")?.unwrap_or(false);
    let device_id = opt_str(args, "deviceId")?;
    if let Some(id) = device_id {
        device_safe(id)?;
    }
    if let Some(name) = name {
        lldb_safe(name, "name")?;
    }
    if pid.is_none() && name.is_none() {
        return Err("pass pid or name".into());
    }
    if wait_for && (name.is_none() || pid.is_some()) {
        return Err("waitFor needs name (and no pid)".into());
    }
    let port = opt_u64(args, "port", 65_535)?.unwrap_or(5039);
    let process_command = |prefix: &str| match (pid, name) {
        (Some(pid), _) => format!("{prefix}process attach --pid {pid}"),
        (None, Some(name)) => {
            format!(
                "{prefix}process attach --name \"{name}\"{}",
                if wait_for { " --waitfor" } else { "" }
            )
        }
        (None, None) => String::new(),
    };
    let label = match (pid, name) {
        (Some(pid), _) => format!("pid {pid}"),
        (None, Some(name)) => name.to_string(),
        (None, None) => String::new(),
    };
    let mut timeout = ATTACH_TIMEOUT;
    let mut arguments = json!({"stopOnEntry": true, "commandEscapePrefix": "`"});
    let mut extra = Map::new();
    match target {
        "local" | "ios-simulator" => {
            if wait_for {
                timeout = LONG_ATTACH_TIMEOUT;
                extra.insert("attachCommands".into(), json!([process_command("")]));
            } else {
                let pid = match (pid, name) {
                    (Some(pid), _) => pid as i64,
                    (None, Some(name)) => resolve_pid(target, name, device_id)?,
                    (None, None) => return Err("pass pid or name".into()),
                };
                refuse_own_chain(pid)?;
                extra.insert("pid".into(), json!(pid));
            }
        }
        "ios-device" => {
            let id =
                device_id.ok_or("deviceId is required for ios-device (see re_list_devices)")?;
            timeout = LONG_ATTACH_TIMEOUT;
            extra.insert(
                "attachCommands".into(),
                json!([
                    "platform select remote-ios",
                    format!("device select {id}"),
                    process_command("device ")
                ]),
            );
        }
        _ => {
            timeout = LONG_ATTACH_TIMEOUT;
            let host = device_id.unwrap_or("localhost");
            extra.insert(
                "attachCommands".into(),
                json!([
                    "platform select remote-android",
                    format!("platform connect connect://{host}:{port}"),
                    process_command(""),
                ]),
            );
        }
    }
    if let Some(obj) = arguments.as_object_mut() {
        obj.extend(extra);
    }
    let request = StartRequest {
        target: target.to_string(),
        mode: "attach",
        label: label.clone(),
        arguments,
        timeout,
        wait_for_stop: true,
    };
    match sessions.start(request) {
        Ok((session, stop)) => started(session, stop, "attached to"),
        Err(error) => Err(with_hint(
            format!("attach to {label} failed: {error}"),
            attach_hint(target),
        )),
    }
}

fn launch(sessions: &Sessions, args: &Value) -> ToolResult {
    session_capacity(sessions)?;
    let program = req_str(args, "program")?;
    let cwd = opt_str(args, "cwd")?;
    if let Some(cwd) = cwd
        && !Path::new(cwd).is_dir()
    {
        return Err(format!("cwd {cwd} is not a directory").into());
    }
    let resolved = match cwd {
        Some(cwd) if Path::new(program).is_relative() => Path::new(cwd).join(program),
        _ => Path::new(program).to_path_buf(),
    };
    if !resolved.is_file() {
        return Err(format!("program {} does not exist", resolved.display()).into());
    }
    let program_args: Vec<String> = match args.get("args") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) if items.len() <= 1024 => items
            .iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or("args must be an array of strings")?,
        Some(_) => return Err("args must be an array of at most 1024 strings".into()),
    };
    let env: Vec<String> = match args.get("env") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(k, v)| {
                v.as_str()
                    .filter(|_| !k.is_empty() && !k.contains('='))
                    .map(|v| format!("{k}={v}"))
            })
            .collect::<Option<_>>()
            .ok_or("env must map variable names to string values")?,
        Some(_) => return Err("env must be an object".into()),
    };
    let stop_at_entry = opt_bool(args, "stopAtEntry")?.unwrap_or(true);
    let mut arguments = json!({
        "program": resolved.display().to_string(),
        "args": program_args,
        "env": env,
        "stopOnEntry": stop_at_entry,
        "commandEscapePrefix": "`",
    });
    if let (Some(cwd), Some(obj)) = (cwd, arguments.as_object_mut()) {
        obj.insert("cwd".into(), json!(cwd));
    }
    let label = resolved
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.to_string());
    let request = StartRequest {
        target: "local".into(),
        mode: "launch",
        label,
        arguments,
        timeout: ATTACH_TIMEOUT,
        wait_for_stop: stop_at_entry,
    };
    match sessions.start(request) {
        Ok((session, stop)) => started(session, stop, "launched"),
        Err(error) => Err(with_hint(
            format!("launch failed: {error}"),
            attach_hint("local"),
        )),
    }
}

fn detach(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let kill = opt_bool(args, "kill")?.unwrap_or(session.mode == "launch");
    sessions.remove(&session.id);
    session.shutdown(kill);
    let verb = if kill {
        "killed the process and closed"
    } else {
        "detached and closed"
    };
    Ok((
        format!("{verb} session {}", session.id),
        json!({"sessionId": session.id, "killed": kill}),
    ))
}

fn list_sessions(sessions: &Sessions) -> ToolResult {
    let list: Vec<Value> = sessions.list().iter().map(|s| s.to_json()).collect();
    Ok((
        format!("{} open sessions", list.len()),
        json!({"sessions": list}),
    ))
}

// ---------------------------------------------------------------- execution

fn resume(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let thread = thread_arg(&session, args)?;
    let previous = mark_running(&session);
    if let Err(error) =
        session
            .dap
            .request("continue", json!({"threadId": thread}), REQUEST_TIMEOUT)
    {
        restore_state(&session, previous);
        return Err(error.into());
    }
    Ok((
        "resumed; call re_wait for the next stop".into(),
        json!({"state": "running"}),
    ))
}

/// Marks a stopped session running and drops stale stops before a resume
/// request; the adapter's own stopped event may then arrive at any moment.
fn mark_running(session: &Session) -> String {
    session.dap.with_state(|s| {
        // Stops before this resume are stale for re_wait.
        s.run_events.clear();
        if s.run_state == "stopped" {
            std::mem::replace(&mut s.run_state, "running".into())
        } else {
            s.run_state.clone()
        }
    })
}

/// Undoes mark_running when the adapter refused the resume.
fn restore_state(session: &Session, previous: String) {
    session.dap.with_state(|s| {
        if s.run_state == "running" && s.run_events.is_empty() {
            s.run_state = previous;
        }
    });
}

fn pause(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let thread = thread_arg(&session, args)?;
    session
        .dap
        .request("pause", json!({"threadId": thread}), REQUEST_TIMEOUT)?;
    Ok((
        "pause requested; call re_wait for the stop".into(),
        json!({"requested": true}),
    ))
}

fn step(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let kind = req_str(args, "kind")?;
    let (command, granularity) = match kind {
        "in" => ("stepIn", "statement"),
        "over" => ("next", "statement"),
        "out" => ("stepOut", "statement"),
        "instruction" => ("next", "instruction"),
        _ => return Err("kind must be in, over, out or instruction".into()),
    };
    let thread = thread_arg(&session, args)?;
    // Check and claim the stop in one lock so two quick steps cannot both pass.
    let previous = session.dap.with_state(|s| {
        (s.run_state == "stopped").then(|| {
            s.run_events.clear();
            std::mem::replace(&mut s.run_state, "running".into())
        })
    });
    let Some(previous) = previous else {
        return Err("the process is not stopped; re_pause or re_wait first".into());
    };
    if let Err(error) = session.dap.request(
        command,
        json!({"threadId": thread, "granularity": granularity}),
        REQUEST_TIMEOUT,
    ) {
        restore_state(&session, previous);
        return Err(error.into());
    }
    Ok((
        format!("step {kind} started; call re_wait for the new location"),
        json!({"threadId": thread, "kind": kind}),
    ))
}

fn wait(sessions: &Sessions, args: &Value) -> ToolResult {
    let timeout = opt_u64(args, "timeoutMs", MAX_WAIT_MS)?.unwrap_or(30_000);
    let session = session_arg(sessions, args)?;
    session
        .dap
        .wait_until(Duration::from_millis(timeout), |s| !s.run_events.is_empty());
    let event = session.dap.with_state(|s| {
        let event = s.run_events.pop_front();
        // exited is always followed by terminated; report them as one.
        if event.as_ref().is_some_and(|e| e["event"] == "exited")
            && s.run_events
                .front()
                .is_some_and(|e| e["event"] == "terminated")
        {
            s.run_events.pop_front();
        }
        event
    });
    match event {
        Some(event) => Ok(stop_json(&session, &event)),
        None => {
            let (state, closed) = session.dap.with_state(|s| (s.run_state.clone(), s.closed));
            if closed {
                return Err("the debug adapter exited; re_detach this session".into());
            }
            Ok((
                format!("no stop within {timeout} ms (state: {state})"),
                json!({"timedOut": true, "state": state}),
            ))
        }
    }
}

// ---------------------------------------------------------------- breakpoints

fn breakpoint_set(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let function = opt_str(args, "function")?;
    let file = opt_str(args, "file")?;
    let line = opt_u64(args, "line", u32::MAX as u64)?;
    let has_address = args.get("address").is_some_and(|v| !v.is_null());
    let spec = match (function, has_address, file, line) {
        (Some(f), false, None, None) if !f.is_empty() => BpSpec::Function(f.to_string()),
        (None, true, None, None) => BpSpec::Address(parse_address(args.get("address"), "address")?),
        (None, false, Some(file), Some(line)) if line > 0 && !file.is_empty() => BpSpec::Line {
            file: file.to_string(),
            line,
        },
        _ => return Err("pass exactly one of function, address, or file+line".into()),
    };
    let condition = opt_str(args, "condition")?
        .filter(|c| !c.is_empty())
        .map(str::to_string);
    let bp = session.add_breakpoint(spec, condition)?;
    let data = bp.to_json();
    let summary = format!(
        "breakpoint {} set ({})",
        bp.id,
        if data["verified"] == true {
            "resolved"
        } else {
            "pending: not resolved yet"
        }
    );
    Ok((summary, data))
}

fn breakpoint_list(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let list: Vec<Value> = session.breakpoints().iter().map(|b| b.to_json()).collect();
    Ok((
        format!("{} breakpoints", list.len()),
        json!({"breakpoints": list}),
    ))
}

fn breakpoint_clear(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let id = opt_u64(args, "id", u64::MAX)?;
    let removed = session.clear_breakpoints(id)?;
    Ok((
        format!("removed {removed} breakpoints"),
        json!({"removed": removed}),
    ))
}

// ---------------------------------------------------------------- inspection

fn threads(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let body = session.dap.request("threads", json!({}), REQUEST_TIMEOUT)?;
    let list = body.get("threads").cloned().unwrap_or_else(|| json!([]));
    let count = list.as_array().map_or(0, Vec::len);
    let stopped = session.dap.with_state(|s| {
        s.last_stop
            .as_ref()
            .and_then(|b| b.get("threadId"))
            .cloned()
    });
    Ok((
        format!("{count} threads"),
        json!({"threads": list, "stoppedThreadId": stopped}),
    ))
}

fn simplify_frames(body: &Value) -> Vec<Value> {
    body.get("stackFrames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|f| {
            json!({
                "id": f.get("id"),
                "name": f.get("name"),
                "pc": f.get("instructionPointerReference"),
                "source": f.pointer("/source/path").or_else(|| f.pointer("/source/name")),
                "line": f.get("line"),
                "module": f.get("moduleId"),
            })
        })
        .collect()
}

fn backtrace(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let thread = thread_arg(&session, args)?;
    let levels = opt_u64(args, "levels", MAX_FRAMES)?.unwrap_or(20).max(1);
    let body = session.dap.request(
        "stackTrace",
        json!({"threadId": thread, "startFrame": 0, "levels": levels}),
        REQUEST_TIMEOUT,
    )?;
    let frames = simplify_frames(&body);
    let summary = format!(
        "thread {thread}: {}",
        frames
            .iter()
            .take(5)
            .filter_map(|f| f["name"].as_str())
            .collect::<Vec<_>>()
            .join(" <- ")
    );
    Ok((
        summary,
        json!({"threadId": thread, "totalFrames": body.get("totalFrames"), "frames": frames}),
    ))
}

fn frame_id(session: &Session, thread: i64, index: u64) -> Result<i64, ToolError> {
    let body = session.dap.request(
        "stackTrace",
        json!({"threadId": thread, "startFrame": index, "levels": 1}),
        REQUEST_TIMEOUT,
    )?;
    body.pointer("/stackFrames/0/id")
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("thread {thread} has no frame {index}").into())
}

fn variables(session: &Session, reference: i64) -> Result<Vec<Value>, ToolError> {
    let body = session.dap.request(
        "variables",
        json!({"variablesReference": reference}),
        REQUEST_TIMEOUT,
    )?;
    Ok(body
        .get("variables")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

fn registers(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let thread = thread_arg(&session, args)?;
    let index = opt_u64(args, "frame", MAX_FRAMES)?.unwrap_or(0);
    let all = opt_bool(args, "all")?.unwrap_or(false);
    let frame = frame_id(&session, thread, index)?;
    let scopes = session
        .dap
        .request("scopes", json!({"frameId": frame}), REQUEST_TIMEOUT)?;
    let scope_ref = scopes
        .get("scopes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|s| {
            s["name"]
                .as_str()
                .is_some_and(|n| n.to_lowercase().contains("register"))
        })
        .and_then(|s| s["variablesReference"].as_i64())
        .ok_or("this lldb-dap reports no Registers scope; use re_evaluate `register read`")?;
    let mut sets = Map::new();
    for set in variables(&session, scope_ref)?
        .iter()
        .take(if all { usize::MAX } else { 1 })
    {
        let name = set["name"].as_str().unwrap_or("registers").to_string();
        let reference = set["variablesReference"].as_i64().unwrap_or(0);
        let mut values = Map::new();
        if reference > 0 {
            for reg in variables(&session, reference)? {
                if let Some(reg_name) = reg["name"].as_str() {
                    values.insert(reg_name.to_string(), reg["value"].clone());
                }
            }
        }
        sets.insert(name, Value::Object(values));
    }
    let pc = sets
        .values()
        .find_map(|regs| regs.get("pc").or_else(|| regs.get("rip")).cloned());
    let summary = format!(
        "{} register set(s) for thread {thread} frame {index}{}",
        sets.len(),
        pc.and_then(|p| p.as_str().map(|p| format!(", pc = {p}")))
            .unwrap_or_default()
    );
    Ok((
        summary,
        json!({"threadId": thread, "frame": index, "sets": sets}),
    ))
}

pub fn hex_ascii(bytes: &[u8]) -> (String, String) {
    let hex = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let ascii = bytes
        .iter()
        .map(|&b| {
            if (0x20..0x7f).contains(&b) {
                b as char
            } else {
                '.'
            }
        })
        .collect();
    (hex, ascii)
}

fn read_memory(sessions: &Sessions, args: &Value) -> ToolResult {
    let address = parse_address(args.get("address"), "address")?;
    let count = opt_u64(args, "count", MAX_READ_BYTES)?.ok_or("count is required")?;
    if count == 0 {
        return Err("count must be at least 1".into());
    }
    let session = session_arg(sessions, args)?;
    let body = session.dap.request(
        "readMemory",
        json!({"memoryReference": format!("0x{address:x}"), "offset": 0, "count": count}),
        REQUEST_TIMEOUT,
    )?;
    let data = body.get("data").and_then(Value::as_str).unwrap_or("");
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("adapter returned invalid base64: {e}"))?;
    bytes.truncate(count as usize);
    let (hex, ascii) = hex_ascii(&bytes);
    let start = body
        .get("address")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("0x{address:x}"));
    let unreadable = body
        .get("unreadableBytes")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let preview: String = hex.chars().take(64).collect();
    Ok((
        format!(
            "read {} bytes at {start}{}: {preview}{}",
            bytes.len(),
            if unreadable > 0 {
                format!(" ({unreadable} unreadable)")
            } else {
                String::new()
            },
            if hex.len() > 64 { "…" } else { "" }
        ),
        json!({"address": start, "count": bytes.len(), "unreadableBytes": unreadable, "hex": hex, "ascii": ascii}),
    ))
}

fn disassemble(sessions: &Sessions, args: &Value) -> ToolResult {
    let address = parse_address(args.get("address"), "address")?;
    let count = opt_u64(args, "instructionCount", MAX_INSTRUCTIONS)?
        .unwrap_or(32)
        .max(1);
    let session = session_arg(sessions, args)?;
    let body = session.dap.request(
        "disassemble",
        json!({
            "memoryReference": format!("0x{address:x}"),
            "instructionOffset": 0,
            "instructionCount": count,
            "resolveSymbols": true,
        }),
        REQUEST_TIMEOUT,
    )?;
    let instructions: Vec<Value> = body
        .get("instructions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(count as usize)
        .map(|i| {
            json!({
                "address": i.get("address"),
                "bytes": i.get("instructionBytes"),
                "instruction": i.get("instruction"),
                "symbol": i.get("symbol"),
                "line": i.get("line"),
            })
        })
        .collect();
    let first = instructions
        .first()
        .and_then(|i| i["instruction"].as_str())
        .unwrap_or("");
    Ok((
        format!(
            "{} instructions at 0x{address:x}; first: {first}",
            instructions.len()
        ),
        json!({"address": format!("0x{address:x}"), "instructions": instructions}),
    ))
}

fn modules(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let body = session.dap.request("modules", json!({}), REQUEST_TIMEOUT)?;
    let all = body
        .get("modules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let list: Vec<Value> = all
        .iter()
        .take(MAX_MODULES)
        .map(|m| {
            json!({
                "id": m.get("id"),
                "name": m.get("name"),
                "path": m.get("path"),
                "addressRange": m.get("addressRange"),
                "symbolStatus": m.get("symbolStatus"),
            })
        })
        .collect();
    Ok((
        format!("{} modules loaded", all.len()),
        json!({"total": all.len(), "truncated": all.len() > MAX_MODULES, "modules": list}),
    ))
}

fn evaluate(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let expression = req_str(args, "expression")?;
    let context = opt_str(args, "context")?.unwrap_or("repl");
    if context != "repl" && context != "watch" {
        return Err("context must be repl or watch".into());
    }
    let frame = match opt_u64(args, "frameId", i64::MAX as u64)? {
        Some(id) => Some(id as i64),
        None if session.dap.with_state(|s| s.run_state == "stopped") => session
            .default_thread()
            .ok()
            .and_then(|t| frame_id(&session, t, 0).ok()),
        None => None,
    };
    // lldb-dap's default auto REPL mode runs backtick-prefixed text as an LLDB command.
    let text = if context == "repl" && !expression.starts_with('`') {
        format!("`{expression}")
    } else {
        expression.to_string()
    };
    let mut request = json!({"expression": text, "context": context});
    if let (Some(frame), Some(obj)) = (frame, request.as_object_mut()) {
        obj.insert("frameId".into(), json!(frame));
    }
    let body = session.dap.request("evaluate", request, REQUEST_TIMEOUT)?;
    let full = body.get("result").and_then(Value::as_str).unwrap_or("");
    let result = truncate_at_char(full, MAX_TEXT_PER_CALL);
    let first_line = result.lines().next().unwrap_or("").to_string();
    Ok((
        format!("{context}: {}", truncate_at_char(&first_line, 200)),
        json!({
            "result": result,
            "truncated": result.len() < full.len(),
            "type": body.get("type"),
            "variablesReference": body.get("variablesReference"),
        }),
    ))
}

fn output(sessions: &Sessions, args: &Value) -> ToolResult {
    let session = session_arg(sessions, args)?;
    let since = opt_u64(args, "sinceSeq", u64::MAX)?.unwrap_or(0);
    let (chunks, more, dropped) = session.dap.with_state(|s| {
        let (chunks, more) = s.output.read_since(since, MAX_TEXT_PER_CALL);
        (chunks, more, s.output.dropped_bytes)
    });
    let next = chunks.last().map_or(since, |c| c.seq);
    let bytes: usize = chunks.iter().map(|c| c.text.len()).sum();
    let list: Vec<Value> = chunks
        .iter()
        .map(|c| json!({"seq": c.seq, "category": c.category, "text": c.text}))
        .collect();
    Ok((
        format!(
            "{} output chunks ({bytes} bytes){}",
            list.len(),
            if more { "; more available" } else { "" }
        ),
        json!({"chunks": list, "nextSeq": next, "more": more, "droppedBytes": dropped}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_is_prefixed_and_mentions_live_processes() {
        let tools = tool_list();
        assert_eq!(tools.len(), 22);
        for t in &tools {
            let name = t["name"].as_str().unwrap();
            assert!(name.starts_with("re_"));
            let description = t["description"].as_str().unwrap().to_lowercase();
            assert!(
                description.contains("live") || description.contains("running"),
                "{name} description must say it acts on live processes"
            );
            assert_eq!(t["inputSchema"]["type"], "object");
            assert!(call(&Sessions::default(), name, &json!(null)).is_some());
            assert_ne!(
                t["annotations"]["readOnlyHint"], true,
                "{name} must not be auto-approvable"
            );
            assert_eq!(
                t["annotations"]["destructiveHint"] == true,
                DESTRUCTIVE_TOOLS.contains(&name),
                "{name} destructiveHint"
            );
        }
    }

    #[test]
    fn parses_addresses() {
        assert_eq!(parse_address(Some(&json!("0x10")), "a").unwrap(), 16);
        assert_eq!(parse_address(Some(&json!("0X1_0")), "a").unwrap(), 16);
        assert_eq!(parse_address(Some(&json!("42")), "a").unwrap(), 42);
        assert_eq!(parse_address(Some(&json!(7)), "a").unwrap(), 7);
        assert!(parse_address(Some(&json!("0xZZ")), "a").is_err());
        assert!(parse_address(Some(&json!(-1)), "a").is_err());
        assert!(parse_address(None, "a").is_err());
    }

    fn err(name: &str, args: Value) -> String {
        match call(&Sessions::default(), name, &args) {
            Some(Err(e)) => e.message,
            other => format!("expected an error, got {other:?}"),
        }
    }

    #[test]
    fn validates_arguments_and_caps() {
        let s = json!("s1");
        assert!(
            err(
                "re_read_memory",
                json!({"sessionId": s, "address": "0x1", "count": 65_537})
            )
            .contains("maximum is 65536")
        );
        assert!(
            err(
                "re_disassemble",
                json!({"sessionId": s, "address": "0x1", "instructionCount": 401})
            )
            .contains("maximum is 400")
        );
        assert!(err("re_wait", json!({"sessionId": s, "timeoutMs": 60_001})).contains("maximum"));
        assert!(err("re_continue", json!({})).contains("sessionId is required"));
        assert!(err("re_continue", json!({"sessionId": "nope"})).contains("no session"));
        assert!(err("re_attach", json!({"target": "mars", "pid": 1})).contains("target must be"));
        assert!(err("re_attach", json!({"target": "local"})).contains("pid or name"));
        assert!(
            err(
                "re_attach",
                json!({"target": "local", "pid": 1, "name": "x", "waitFor": true})
            )
            .contains("waitFor")
        );
        assert!(
            err(
                "re_attach",
                json!({"target": "local", "name": "a\"; platform shell rm"})
            )
            .contains("cannot be passed")
        );
        assert!(
            err(
                "re_attach",
                json!({"target": "android", "pid": 1, "deviceId": "x y"})
            )
            .contains("deviceId")
        );
        assert!(err("re_attach", json!({"target": "local", "pid": "1"})).contains("integer"));
        assert!(
            err("re_launch", json!({"program": "/definitely/missing"})).contains("does not exist")
        );
        assert!(
            err("re_list_processes", json!({"target": "local", "filter": 3})).contains("string")
        );
        assert!(err("re_environment", json!([])).contains("object"));
        assert!(call(&Sessions::default(), "re_nope", &json!({})).is_none());
    }

    #[test]
    fn hex_ascii_renders_printables() {
        let (hex, ascii) = hex_ascii(b"Hi\x00\xff");
        assert_eq!(hex, "486900ff");
        assert_eq!(ascii, "Hi..");
    }

    #[test]
    fn refuses_to_attach_to_itself_or_a_parent() {
        let sessions = Sessions::default();
        let own = [
            Some(u64::from(std::process::id())),
            #[cfg(unix)]
            Some(u64::from(std::os::unix::process::parent_id())),
        ];
        for pid in own.into_iter().flatten() {
            let error = call(
                &sessions,
                "re_attach",
                &json!({"target": "local", "pid": pid}),
            )
            .unwrap()
            .unwrap_err();
            assert!(error.message.contains("its parents"), "{}", error.message);
        }
        assert_eq!(sessions.count(), 0);
    }

    #[test]
    fn stop_during_continue_is_not_overwritten() {
        let (client, mut fake) = crate::dap::fake::connect();
        let sessions = Sessions::default();
        let session = sessions.insert_fake(client);
        session.dap.with_state(|s| s.run_state = "stopped".into());
        let adapter = std::thread::spawn(move || {
            let request = fake.next_request();
            assert_eq!(request["command"], "continue");
            // A breakpoint right at the pc: the stop beats the response.
            fake.event("stopped", json!({"reason": "breakpoint", "threadId": 1}));
            fake.reply(&request, json!({"allThreadsContinued": true}));
            fake
        });
        let args = json!({"sessionId": session.id, "threadId": 1});
        call(&sessions, "re_continue", &args).unwrap().unwrap();
        let _fake = adapter.join().unwrap();
        assert_eq!(session.dap.with_state(|s| s.run_state.clone()), "stopped");
        assert_eq!(session.dap.with_state(|s| s.run_events.len()), 1);
    }

    #[test]
    fn step_claims_the_stop_and_restores_it_on_failure() {
        let (client, mut fake) = crate::dap::fake::connect();
        let sessions = Sessions::default();
        let session = sessions.insert_fake(client);
        session.dap.with_state(|s| s.run_state = "stopped".into());
        let adapter = std::thread::spawn(move || {
            let request = fake.next_request();
            fake.send(
                json!({"seq": 0, "type": "response", "request_seq": request["seq"],
                "command": request["command"], "success": false, "message": "nope"}),
            );
            let request = fake.next_request();
            assert_eq!(request["command"], "next");
            fake.reply(&request, json!({}));
            fake
        });
        let args = json!({"sessionId": session.id, "threadId": 1, "kind": "over"});
        assert!(call(&sessions, "re_step", &args).unwrap().is_err());
        assert_eq!(session.dap.with_state(|s| s.run_state.clone()), "stopped");
        call(&sessions, "re_step", &args).unwrap().unwrap();
        let _fake = adapter.join().unwrap();
        // A second step before any stop is refused instead of racing the first.
        let error = call(&sessions, "re_step", &args).unwrap().unwrap_err();
        assert!(error.message.contains("not stopped"), "{}", error.message);
    }
}
