//! End-to-end tests against the built binary and the host's real lldb-dap.
//! Skipped (with a note) when lldb-dap or a C compiler is missing.
#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]
#![cfg_attr(not(unix), allow(dead_code))]

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::thread;
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_viscosity-live-re");

struct Mcp {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<Value>,
    next_id: i64,
}

impl Mcp {
    fn start() -> Self {
        let mut child = Command::new(BIN)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(serde_json::from_str(&line).unwrap()).is_err() {
                    break;
                }
            }
        });
        let mut mcp = Self {
            child,
            stdin,
            lines,
            next_id: 0,
        };
        let init = mcp.request(
            "initialize",
            json!({"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}),
        );
        assert_eq!(init["protocolVersion"], "2025-06-18");
        mcp.send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
        mcp
    }

    fn send(&mut self, message: Value) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{message}").unwrap();
        stdin.flush().unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let message = self
                .lines
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|_| panic!("no reply to {method}"));
            if message["id"] == id {
                assert!(message.get("error").is_none(), "{method}: {message}");
                return message["result"].clone();
            }
        }
    }

    /// Calls a tool and returns its structured content; fails on isError.
    fn tool(&mut self, name: &str, arguments: Value) -> Value {
        let result = self.request("tools/call", json!({"name": name, "arguments": arguments}));
        assert_eq!(
            result["isError"], false,
            "{name} failed: {}",
            result["content"][0]["text"]
        );
        result["structuredContent"].clone()
    }

    /// Waits until the session reports `event`, skipping other stops.
    fn wait_for(&mut self, session: &str, events: &[&str]) -> Value {
        for _ in 0..5 {
            let got = self.tool(
                "re_wait",
                json!({"sessionId": session, "timeoutMs": 30_000}),
            );
            if events.iter().any(|e| got["event"] == *e) {
                return got;
            }
        }
        panic!("session {session} never reported {events:?}");
    }

    fn close(mut self) -> std::process::ExitStatus {
        drop(self.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "server did not exit after stdin EOF"
            );
            thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("viscosity-live-re-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn have_tools() -> bool {
    if let Err(error) = viscosity_live_re::host::find_debugger() {
        eprintln!("skipping: {error}");
        return false;
    }
    if c_compiler().is_none() {
        eprintln!("skipping: no `cc` C compiler on PATH");
        return false;
    }
    true
}

/// `host::which` hides macOS `/usr/bin` shims, and there the only `cc` is
/// `/usr/bin/cc`; it is safe (no CLT installer prompt) once a developer
/// directory is selected.
fn c_compiler() -> Option<PathBuf> {
    use viscosity_live_re::host;
    host::which("cc").or_else(|| {
        let cc = Path::new("/usr/bin/cc");
        (host::developer_dir().is_some() && cc.is_file()).then(|| cc.to_path_buf())
    })
}

fn compile(dir: &Path, name: &str, source: &str) -> PathBuf {
    let src = dir.join(format!("{name}.c"));
    let exe = dir.join(name);
    std::fs::write(&src, source).unwrap();
    let status = Command::new(c_compiler().expect("have_tools checked cc"))
        .args(["-g", "-O0", "-o"])
        .arg(&exe)
        .arg(&src)
        .status()
        .unwrap();
    assert!(status.success(), "cc failed");
    exe
}

const LOOPER: &str = "#include <stdio.h>\n#include <unistd.h>\n\
int main(void) { printf(\"ready\\n\"); fflush(stdout); for (;;) usleep(50000); }\n";

fn alive(pid: i64) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[test]
fn hello_and_unknown_flags() {
    let out = Command::new(BIN).arg("--hello").output().unwrap();
    assert!(out.status.success());
    let hello: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(hello["helper"], "viscosity-live-re");
    assert_eq!(hello["helperVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(hello["protocolVersion"], 1);
    let out = Command::new(BIN).arg("--bogus").output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn environment_report_and_protocol_mismatch() {
    let out = Command::new(BIN).arg("--environment").output().unwrap();
    assert!(out.status.success());
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["environmentVersion"], 1);
    assert!(report["targets"]["windows"]["state"].is_string());

    // A host speaking another tool contract is refused before MCP starts.
    let out = Command::new(BIN)
        .env("VISCOSITY_LIVE_RE_PROTOCOL", "999")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&out.stderr).contains("protocol"));
    let out = Command::new(BIN)
        .env("VISCOSITY_LIVE_RE_PROTOCOL", "1")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success());
}

#[test]
#[cfg(unix)]
fn launch_break_inspect_and_exit() {
    if !have_tools() {
        return;
    }
    let dir = TempDir::new("launch");
    let exe = compile(
        &dir.0,
        "target",
        "#include <stdio.h>\nint target_fn(int x) { return x * 2; }\n\
         int main(void) { printf(\"result %d\\n\", target_fn(21)); return 0; }\n",
    );
    let mut mcp = Mcp::start();
    let env = mcp.tool("re_environment", json!({}));
    assert_eq!(env["debugger"]["found"], true);

    let launched = mcp.tool("re_launch", json!({"program": exe, "stopAtEntry": true}));
    let session = launched["sessionId"].as_str().unwrap().to_string();
    let s = json!(session);

    let bp = mcp.tool(
        "re_breakpoint_set",
        json!({"sessionId": s, "function": "target_fn"}),
    );
    assert_eq!(bp["kind"], "function");
    let list = mcp.tool("re_breakpoint_list", json!({"sessionId": s}));
    assert_eq!(list["breakpoints"].as_array().unwrap().len(), 1);

    mcp.tool("re_continue", json!({"sessionId": s}));
    let stop = mcp.wait_for(&session, &["stopped"]);
    assert!(
        stop["frames"][0]["name"]
            .as_str()
            .unwrap()
            .contains("target_fn"),
        "{stop}"
    );

    let bt = mcp.tool("re_backtrace", json!({"sessionId": s, "levels": 10}));
    let names: Vec<&str> = bt["frames"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| f["name"].as_str())
        .collect();
    assert!(names.iter().any(|n| n.contains("main")), "{names:?}");

    let regs = mcp.tool("re_registers", json!({"sessionId": s}));
    assert!(!regs["sets"].as_object().unwrap().is_empty(), "{regs}");

    let pc = bt["frames"][0]["pc"].as_str().unwrap().to_string();
    let mem = mcp.tool(
        "re_read_memory",
        json!({"sessionId": s, "address": pc, "count": 16}),
    );
    assert_eq!(mem["hex"].as_str().unwrap().len(), 32, "{mem}");

    let dis = mcp.tool(
        "re_disassemble",
        json!({"sessionId": s, "address": pc, "instructionCount": 4}),
    );
    assert_eq!(dis["instructions"].as_array().unwrap().len(), 4, "{dis}");

    let eval = mcp.tool(
        "re_evaluate",
        json!({"sessionId": s, "expression": "x", "context": "watch"}),
    );
    assert_eq!(eval["result"], "21", "{eval}");
    let repl = mcp.tool(
        "re_evaluate",
        json!({"sessionId": s, "expression": "frame info"}),
    );
    assert!(
        repl["result"].as_str().unwrap().contains("target_fn"),
        "{repl}"
    );

    mcp.tool("re_breakpoint_clear", json!({"sessionId": s}));
    mcp.tool("re_continue", json!({"sessionId": s}));
    let exit = mcp.wait_for(&session, &["exited", "terminated"]);
    if exit["event"] == "exited" {
        assert_eq!(exit["exitCode"], 0);
    }
    let out = mcp.tool("re_output", json!({"sessionId": s}));
    let text: String = out["chunks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["text"].as_str())
        .collect();
    assert!(text.contains("result 42"), "output: {text}");

    mcp.tool("re_detach", json!({"sessionId": s}));
    assert_eq!(mcp.tool("re_sessions", json!({}))["sessions"], json!([]));
    assert!(mcp.close().success());
}

#[test]
#[cfg(unix)]
fn attach_by_pid_pause_and_detach() {
    if !have_tools() {
        return;
    }
    let dir = TempDir::new("attach");
    let exe = compile(&dir.0, "looper", LOOPER);
    let mut target = Command::new(&exe).stdout(Stdio::null()).spawn().unwrap();
    let pid = target.id() as i64;
    thread::sleep(Duration::from_millis(300));

    let mut mcp = Mcp::start();
    let procs = mcp.tool(
        "re_list_processes",
        json!({"target": "local", "filter": "looper"}),
    );
    assert!(
        procs["processes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["pid"] == pid),
        "{procs}"
    );

    let attached = mcp.tool("re_attach", json!({"target": "local", "pid": pid}));
    let s = attached["sessionId"].clone();
    let threads = mcp.tool("re_threads", json!({"sessionId": s}));
    assert!(!threads["threads"].as_array().unwrap().is_empty());
    let modules = mcp.tool("re_modules", json!({"sessionId": s}));
    assert!(modules["total"].as_u64().unwrap() > 0);

    mcp.tool("re_continue", json!({"sessionId": s}));
    thread::sleep(Duration::from_millis(200));
    mcp.tool("re_pause", json!({"sessionId": s}));
    let stop = mcp.wait_for(s.as_str().unwrap(), &["stopped"]);
    assert_eq!(stop["event"], "stopped");

    let detached = mcp.tool("re_detach", json!({"sessionId": s}));
    assert_eq!(detached["killed"], false);
    thread::sleep(Duration::from_millis(300));
    assert!(
        target.try_wait().unwrap().is_none(),
        "detach must leave the process running"
    );
    assert!(mcp.close().success());
    let _ = target.kill();
    let _ = target.wait();
}

#[test]
#[cfg(unix)]
fn server_exit_kills_launched_debuggee() {
    if !have_tools() {
        return;
    }
    let dir = TempDir::new("exit");
    let exe = compile(&dir.0, "looper", LOOPER);
    let mut mcp = Mcp::start();
    let launched = mcp.tool("re_launch", json!({"program": exe, "stopAtEntry": false}));
    let s = launched["sessionId"].clone();
    let deadline = Instant::now() + Duration::from_secs(10);
    let pid = loop {
        let sessions = mcp.tool("re_sessions", json!({}));
        if let Some(pid) = sessions["sessions"][0]["pid"].as_i64() {
            break pid;
        }
        assert!(Instant::now() < deadline, "no pid reported for {s}");
        thread::sleep(Duration::from_millis(100));
    };
    assert!(alive(pid));
    assert!(mcp.close().success());
    let deadline = Instant::now() + Duration::from_secs(10);
    while alive(pid) {
        assert!(
            Instant::now() < deadline,
            "debuggee {pid} survived server exit (ps: {})",
            ps_state(pid)
        );
        thread::sleep(Duration::from_millis(100));
    }
}

/// `ps` state and parent of `pid`, so a timeout tells a zombie from an orphan.
#[cfg(unix)]
fn ps_state(pid: i64) -> String {
    Command::new("ps")
        .args(["-o", "stat=,ppid=,comm=", "-p", &pid.to_string()])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Live descendants of `pid` (children first), via `pgrep -P`.
#[cfg(unix)]
fn descendants(pid: u32) -> Vec<i64> {
    let out = Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
        .unwrap();
    let mut all = Vec::new();
    for child in String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .filter_map(|p| p.parse::<u32>().ok())
    {
        all.push(i64::from(child));
        all.extend(descendants(child));
    }
    all
}

#[test]
#[cfg(unix)]
fn stdin_eof_during_wait_for_attach_leaves_no_adapter() {
    if !have_tools() {
        return;
    }
    let mut mcp = Mcp::start();
    let server = mcp.child.id();
    let name = format!("viscosity_absent_{}", std::process::id());
    mcp.send(
        json!({"jsonrpc": "2.0", "id": 99, "method": "tools/call", "params": {
            "name": "re_attach",
            "arguments": {"target": "local", "name": name, "waitFor": true},
        }}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while descendants(server).is_empty() {
        assert!(Instant::now() < deadline, "lldb-dap never started");
        thread::sleep(Duration::from_millis(50));
    }
    // Let lldb-dap start debugserver and enter its wait.
    thread::sleep(Duration::from_secs(3));
    let helpers = descendants(server);
    assert!(mcp.close().success());
    let deadline = Instant::now() + Duration::from_secs(10);
    while let Some(pid) = helpers.iter().find(|&&p| alive(p)) {
        assert!(
            Instant::now() < deadline,
            "helper {pid} outlived the server (all: {helpers:?})"
        );
        thread::sleep(Duration::from_millis(100));
    }
}
