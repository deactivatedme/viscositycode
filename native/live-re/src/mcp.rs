//! MCP over stdio: newline-delimited JSON-RPC 2.0. `tools/call` runs on its
//! own thread so `ping` and other calls stay responsive during `re_wait`.

use crate::session::Sessions;
use crate::tools::{self, ToolResult};
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

/// Newest first; an unknown client version gets the newest.
pub const SUPPORTED_PROTOCOL_VERSIONS: [&str; 4] =
    ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_LINE: u64 = 4 * 1024 * 1024;
const MAX_INFLIGHT_CALLS: usize = 16;

const INSTRUCTIONS: &str = "Live debugging of RUNNING programs through LLDB (lldb-dap). Start with \
re_environment, then re_list_processes + re_attach, or re_launch. Execution is asynchronous: after \
re_continue, re_step or re_pause call re_wait. re_evaluate with context=repl runs raw LLDB commands. \
Only debug software you are entitled to examine.";

pub fn negotiate_version(requested: Option<&str>) -> &'static str {
    SUPPORTED_PROTOCOL_VERSIONS
        .iter()
        .find(|v| Some(**v) == requested)
        .copied()
        .unwrap_or(SUPPORTED_PROTOCOL_VERSIONS[0])
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

/// MCP `CallToolResult`: structured content plus text (summary, then the
/// JSON for clients without structuredContent support).
pub fn tool_result(result: ToolResult) -> Value {
    match result {
        Ok((summary, data)) => json!({
            "content": [
                {"type": "text", "text": summary},
                {"type": "text", "text": data.to_string()},
            ],
            "structuredContent": data,
            "isError": false,
        }),
        Err(error) => {
            let mut text = format!("error: {}", error.message);
            if let Some(hint) = &error.hint {
                text.push_str("\nhint: ");
                text.push_str(hint);
            }
            json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": {"error": error.message, "hint": error.hint},
                "isError": true,
            })
        }
    }
}

pub struct Server {
    pub sessions: Sessions,
    out: Mutex<Box<dyn Write + Send>>,
    inflight: AtomicUsize,
}

impl Server {
    pub fn new(out: Box<dyn Write + Send>) -> Arc<Self> {
        Arc::new(Self {
            sessions: Sessions::default(),
            out: Mutex::new(out),
            inflight: AtomicUsize::new(0),
        })
    }

    fn write(&self, message: &Value) {
        let mut out = self.out.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = writeln!(out, "{message}");
        let _ = out.flush();
    }

    /// Ends every session, lets in-flight tool calls send their replies, then
    /// stops writing: exiting while a worker is mid-`writeln!` would leave a
    /// truncated JSON line on stdout.
    pub fn shutdown(&self) {
        self.sessions.close_all();
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.inflight.load(Ordering::Acquire) > 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let mut out = self.out.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = out.flush();
        *out = Box::new(io::sink());
    }

    /// Synchronous handling of one message; `None` for notifications.
    pub fn respond(&self, message: &Value) -> Option<Value> {
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            // Responses to requests we never send, or garbage with an id.
            return message
                .get("id")
                .filter(|_| message.get("result").is_none() && message.get("error").is_none())
                .map(|id| error_response(id.clone(), -32600, "invalid request"));
        };
        let id = message.get("id").cloned()?; // notifications get no reply
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
        let result = match method {
            "initialize" => {
                let version =
                    negotiate_version(params.get("protocolVersion").and_then(Value::as_str));
                json!({
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": false}},
                    "serverInfo": {"name": "viscosity-live-re", "version": env!("CARGO_PKG_VERSION")},
                    "instructions": INSTRUCTIONS,
                })
            }
            "ping" => json!({}),
            "tools/list" => json!({"tools": tools::tool_list()}),
            "tools/call" => {
                let Some(name) = params.get("name").and_then(Value::as_str) else {
                    return Some(error_response(id, -32602, "tools/call needs a tool name"));
                };
                let args = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match tools::call(&self.sessions, name, &args) {
                    Some(result) => tool_result(result),
                    None => {
                        return Some(error_response(id, -32602, &format!("unknown tool {name}")));
                    }
                }
            }
            _ => {
                return Some(error_response(
                    id,
                    -32601,
                    &format!("method {method} not found"),
                ));
            }
        };
        Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
    }

    pub fn handle_line(self: &Arc<Self>, line: &str) {
        let message: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                self.write(&error_response(Value::Null, -32700, "parse error"));
                return;
            }
        };
        if !message.is_object() {
            // shortcut: JSON-RPC batches (dropped in MCP 2025-06-18) are refused.
            self.write(&error_response(
                Value::Null,
                -32600,
                "batches are not supported",
            ));
            return;
        }
        let is_call = message.get("method").and_then(Value::as_str) == Some("tools/call")
            && message.get("id").is_some();
        if !is_call {
            if let Some(reply) = self.respond(&message) {
                self.write(&reply);
            }
            return;
        }
        if self.inflight.fetch_add(1, Ordering::AcqRel) >= MAX_INFLIGHT_CALLS {
            self.inflight.fetch_sub(1, Ordering::AcqRel);
            let id = message.get("id").cloned().unwrap_or(Value::Null);
            self.write(&error_response(id, -32000, "too many tool calls in flight"));
            return;
        }
        let server = Arc::clone(self);
        thread::spawn(move || {
            if let Some(reply) = server.respond(&message) {
                server.write(&reply);
            }
            server.inflight.fetch_sub(1, Ordering::AcqRel);
        });
    }

    /// Reads stdin until EOF; overlong lines are discarded.
    pub fn run<R: BufRead>(self: &Arc<Self>, mut input: R) {
        let mut line = Vec::new();
        loop {
            line.clear();
            match (&mut input).take(MAX_LINE).read_until(b'\n', &mut line) {
                Ok(0) => return,
                Ok(_) if line.last() != Some(&b'\n') && line.len() as u64 >= MAX_LINE => {
                    // Skip the rest of the oversized line.
                    let mut sink = Vec::new();
                    if input.read_until(b'\n', &mut sink).is_err() {
                        return;
                    }
                    self.write(&error_response(Value::Null, -32600, "message too large"));
                }
                Ok(_) => {
                    let text = String::from_utf8_lossy(&line);
                    if !text.trim().is_empty() {
                        self.handle_line(text.trim());
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> Arc<Server> {
        Server::new(Box::new(io::sink()))
    }

    #[test]
    fn negotiates_protocol_version() {
        assert_eq!(negotiate_version(Some("2025-03-26")), "2025-03-26");
        assert_eq!(negotiate_version(Some("2099-01-01")), "2025-11-25");
        assert_eq!(negotiate_version(None), "2025-11-25");
        let reply = server()
            .respond(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "t"}}}))
            .unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(reply["result"]["serverInfo"]["name"], "viscosity-live-re");
        assert!(reply["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn handles_ping_notifications_and_unknown_methods() {
        let s = server();
        assert_eq!(
            s.respond(&json!({"jsonrpc": "2.0", "id": "a", "method": "ping"}))
                .unwrap()["result"],
            json!({})
        );
        assert!(
            s.respond(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
                .is_none()
        );
        let reply = s
            .respond(&json!({"jsonrpc": "2.0", "id": 2, "method": "resources/list"}))
            .unwrap();
        assert_eq!(reply["error"]["code"], -32601);
        let reply = s
            .respond(&json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "nope"}}))
            .unwrap();
        assert_eq!(reply["error"]["code"], -32602);
    }

    #[test]
    fn tool_errors_are_is_error_results() {
        let reply = server()
            .respond(&json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": {"name": "re_read_memory", "arguments": {"sessionId": "s1", "address": "0x0", "count": 70_000}}}))
            .unwrap();
        let result = &reply["result"];
        assert_eq!(result["isError"], true);
        assert!(
            result["content"][0]["text"]
                .as_str()
                .unwrap()
                .starts_with("error:")
        );
    }

    #[test]
    fn tools_list_and_success_shape() {
        let reply = server()
            .respond(&json!({"jsonrpc": "2.0", "id": 5, "method": "tools/list"}))
            .unwrap();
        assert_eq!(reply["result"]["tools"].as_array().unwrap().len(), 22);
        let result = tool_result(Ok(("ok".into(), json!({"a": 1}))));
        assert_eq!(result["structuredContent"]["a"], 1);
        assert_eq!(result["content"][0]["text"], "ok");
        assert_eq!(result["content"][1]["text"], "{\"a\":1}");
    }

    /// Captures stdout lines for the threaded path.
    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn shutdown_waits_for_inflight_replies_then_drops_output() {
        let capture = Capture::default();
        let s = Server::new(Box::new(capture.clone()));
        s.inflight.fetch_add(1, Ordering::AcqRel);
        let worker = Arc::clone(&s);
        let handle = thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(100));
            worker.write(&json!({"id": 1}));
            worker.inflight.fetch_sub(1, Ordering::AcqRel);
        });
        s.shutdown();
        s.write(&json!({"id": 2}));
        handle.join().unwrap();
        let text = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
        assert_eq!(text, "{\"id\":1}\n");
    }

    #[test]
    fn run_loop_frames_lines_and_reports_parse_errors() {
        let capture = Capture::default();
        let s = Server::new(Box::new(capture.clone()));
        let input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\r\nnot json\n\n[1]\n{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"re_sessions\"}}\n";
        s.run(&input[..]);
        for _ in 0..200 {
            if s.inflight.load(Ordering::Acquire) == 0 {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(5));
        }
        let text = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
        let lines: Vec<Value> = text
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0]["id"], 1);
        assert_eq!(lines[1]["error"]["code"], -32700);
        assert_eq!(lines[2]["error"]["code"], -32600);
        assert_eq!(
            lines[3]["result"]["structuredContent"]["sessions"],
            json!([])
        );
    }
}
